"""Offline DOM/worker harness for policy-restricted Chromium.
Uses original ES-module sources as data modules and bridges API calls to the actual
loopback server. The bridge is test-only: cookie/CSP/origin enforcement is tested
separately by native integration tests, not claimed by this DOM harness.
Requires Python Playwright and Chromium. Start `npm start` first.
"""
from pathlib import Path
import json, re, base64, hashlib, http.cookiejar, urllib.request, urllib.error, platform
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];PUBLIC=ROOT/'public';OUT=ROOT/'reports';BASE='http://127.0.0.1:8787'
(OUT/'screenshots').mkdir(parents=True,exist_ok=True);(OUT/'examples').mkdir(exist_ok=True)
modules={}
def module(path):
    path=path.resolve()
    if path in modules:return modules[path]
    source=path.read_text()
    source=re.sub(r"(from\s*['\"])([^'\"]+)(['\"])",lambda m:m[1]+module(path.parent/m[2])+m[3],source)
    url='data:text/javascript;base64,'+base64.b64encode(source.encode()).decode()
    modules[path]=url;return url
html=(PUBLIC/'index.html').read_text().replace('<link rel="stylesheet" href="/game.css">','<style>'+(PUBLIC/'game.css').read_text()+'</style>')
html=html.replace('<script type="module" src="/game.js"></script>','')
checks=[];errors=[]
def check(name,condition=True):
    assert condition,name
    checks.append({'name':name,'passed':True})
def setup(context,api_enabled=True):
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    def bridge(args):
        if not api_enabled and str(args['path']).startswith('/api/'):raise RuntimeError('Simulated unavailable API')
        assert args['path'].startswith('/') and not args['path'].startswith('//')
        headers=args.get('headers',{});headers['Origin']=BASE
        request=urllib.request.Request(BASE+args['path'],data=args.get('body','').encode() if args.get('body') is not None else None,headers=headers,method=args.get('method','GET'))
        try:response=opener.open(request,timeout=20)
        except urllib.error.HTTPError as e:response=e
        return {'status':response.status,'headers':dict(response.headers),'text':response.read().decode()}
    page.expose_function('__bridge',bridge)
    page.expose_function('__sha256',lambda data:list(hashlib.sha256(bytes(data)).digest()))
    page.set_content(html)
    page.evaluate("""({workerURL})=>{
      for(const name of ['localStorage','sessionStorage']){const map=new Map();Object.defineProperty(window,name,{value:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)},configurable:true});}
      Object.defineProperty(crypto,'subtle',{value:{digest:async(_name,b)=>new Uint8Array(await __sha256(Array.from(new Uint8Array(b)))).buffer}});
      Object.defineProperty(crypto,'randomUUID',{value:()=>{let a=crypto.getRandomValues(new Uint8Array(16));a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;let h=Array.from(a,n=>n.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}});
      window.fetch=async(path,options={})=>{const r=await __bridge({path:String(path),method:options.method||'GET',headers:options.headers||{},body:options.body??null});return new Response(r.text,{status:r.status,headers:r.headers});};
      const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(path,options){if(path!=='/mastermind/analytics-worker.js')throw Error('Unknown worker');super(workerURL,options);}};
      window.__exports=[];const blobs=new Map(),nativeURL=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{const u=nativeURL(b);blobs.set(u,b);return u;};
      HTMLAnchorElement.prototype.click=function(){if(this.download&&blobs.has(this.href)){const name=this.download;blobs.get(this.href).text().then(text=>__exports.push({name,text}));}else throw Error('Unexpected navigation in offline DOM harness');};
    }""",{'workerURL':module(PUBLIC/'mastermind/analytics-worker.js')})
    page.evaluate("async(url)=>{await import(url)}",module(PUBLIC/'game.js'))
    return page
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=setup(browser.new_context(viewport={'width':1440,'height':1080}))
    page.wait_for_function("!document.querySelector('#start').disabled")
    check('Twenty game rows render',page.locator('.guess-row').count()==20)
    check('Board pegs remain circular',page.locator('.guess-pegs .peg').first.evaluate('(el)=>Math.abs(el.getBoundingClientRect().width-el.getBoundingClientRect().height)<1'))
    check('Local opponent attribution is explicit','NOT JEV' in page.locator('#modeBadge').inner_text())
    check('Discord sign-in disabled without credentials',page.locator('#login').is_disabled())
    page.screenshot(path=str(OUT/'screenshots/desktop-setup.png'),full_page=True)
    page.locator('#secretSlots button').first.click();page.keyboard.press('Backspace')
    check('Incomplete secret disables starting',page.locator('#start').is_disabled())
    page.keyboard.press('a');check('Completing secret re-enables starting',not page.locator('#start').is_disabled())
    page.evaluate("document.querySelector('#autoJev').checked=false")
    page.locator('#start').click();page.locator('#guessComposer').wait_for(state='visible')
    def state():return page.evaluate("async()=>await (await fetch('/api/matches/'+JSON.parse(localStorage.getItem('mm:currentMatchId')))).json()")
    current=state();check('Actual API withholds hidden target','reveal' not in current and 'secrets' not in current)
    for turn in range(10):
        current=state()
        if current['phase']!='human_break':break
        code=page.evaluate("async({url,history})=>{const s=await import(url);const id=s.referenceChoice(history,'minimax');return s.CODES[id].map(n=>'ABCDEF'[n]).join('')}",{'url':module(PUBLIC/'mastermind/strategy.js'),'history':current['legs']['human']['history']})
        page.locator('#guessSlots button').first.click();page.keyboard.type(code);page.keyboard.press('Enter')
        page.wait_for_function("n=>document.querySelector('#humanScore').textContent.startsWith(String(n))",arg=turn+1)
        check('Keyboard guess accepted '+str(turn+1))
    check('Human leg transitions correctly',state()['phase']=='jev_break')
    check('Live human counterfactual panel withheld',page.locator('#analysisContent').is_hidden())
    for turn in range(10):
        if state()['phase']!='jev_break':break
        page.locator('#stepJev').click();page.wait_for_function("!document.querySelector('#stepJev').disabled")
        if turn==1:page.screenshot(path=str(OUT/'screenshots/desktop-playing.png'),full_page=True)
    current=state();check('Actual two-leg server match completed',current['phase']=='complete')
    check('Local result internally verified and unranked',current['verified'] and not current['eligible'])
    page.locator('#reviewMatch').click();page.locator('#analysisContent').wait_for(state='visible',timeout=30000)
    check('All-1296 counterfactual coverage displayed','1,296 ALTERNATIVES' in page.locator('#analysisCoverage').inner_text())
    check('SVG entropy chart rendered',page.locator('#entropyChart svg').count()==1)
    page.screenshot(path=str(OUT/'screenshots/desktop-analytics.png'),full_page=True)
    for i,(control,name) in enumerate([('exportJson','sample-analytics.json'),('exportCsv','sample-moves.csv'),('exportDecisions','sample-decisions.csv'),('exportReplay','sample-replay.json'),('exportAlternatives','sample-all-alternatives.csv')]):
        page.locator('#'+control).click();page.wait_for_function('n=>__exports.length>n',arg=i)
        data=page.evaluate('n=>__exports[n]',i);(OUT/'examples'/name).write_text(data['text']);check('Export generated '+name,len(data['text'])>0)
    report=json.loads((OUT/'examples/sample-analytics.json').read_text())
    check('Both actors and exhaustive quality exported',report['comparison']=='all_1296_legal_guesses_per_turn' and len(report['human']['rows'])>0 and len(report['jev']['rows'])>0)
    page.locator('#analysisActor').select_option('jev');check('Turn drilldown populated',page.locator('#moveFacts .fact').count()>=20)
    page.locator('#importReplay').set_input_files(str(OUT/'examples/sample-replay.json'));page.wait_for_function("document.querySelector('#replayVerification').textContent.includes('Valid internal replay')")
    check('Valid replay imported and verified')
    bad=json.loads((OUT/'examples/sample-replay.json').read_text());bad['reveal']['humanTargetSalt']='a'*64
    badpath=OUT/'examples/tampered-replay.fixture.json';badpath.write_text(json.dumps(bad));page.locator('#importReplay').set_input_files(str(badpath))
    page.wait_for_function("document.querySelector('#replayVerification').textContent.includes('Verification failed')");check('Tampered commitment rejected')
    page.locator('[data-page="record"]').click();page.wait_for_function("document.querySelector('#recordStats .stat')");check('Server record displayed',page.locator('#recordHistory tbody tr').count()>=1)
    page.locator('[data-page="leaderboards"]').click();page.wait_for_function("document.querySelector('#leaderConfig').textContent.includes('mm-')")
    check('Local score absent from official board','No eligible results' in page.locator('#leaderTable').inner_text())
    page.locator('#leaderScope').select_option('channel');page.locator('#refreshLeaders').click();page.wait_for_function("document.querySelector('#leaderTable').textContent.includes('fresh /play')");check('Unverified community access rejected')
    mobile=setup(browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,reduced_motion='reduce'))
    mobile.wait_for_function("!document.querySelector('#start').disabled")
    check('390px layout has no viewport overflow',mobile.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    check('Reduced-motion preference available',mobile.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"))
    mobile.screenshot(path=str(OUT/'screenshots/mobile-setup.png'),full_page=True)
    offline=setup(browser.new_context(viewport={'width':1280,'height':900}),api_enabled=False)
    offline.locator('#localStart').click();offline.locator('#guessComposer').wait_for(state='visible');check('Browser-only practice works without API','BROWSER PRACTICE' in offline.locator('#modeBadge').inner_text())
    offline.on('dialog',lambda d:d.accept());offline.locator('#resign').click();offline.locator('#reviewMatch').click();offline.locator('#analysisContent').wait_for(state='visible',timeout=30000)
    check('Offline forfeit replay and analysis complete')
    check('No JavaScript runtime errors',not errors)
    browser.close()
result={'generatedAt':datetime.now(timezone.utc).isoformat(),'harness':'Python Playwright offline DOM + real module worker + loopback HTTP bridge',
 'platform':platform.platform(),'checks':checks,'passed':len(checks),'failed':0,'runtimeErrors':errors,
 'liveDiscordTested':False,'liveJevTested':False,'cloudflareDeploymentTested':False,
 'limitations':['Native Chromium HTTP navigation was blocked by administrator URL policy; the policy was not changed.',
 'The DOM harness loads unchanged module logic through data URLs; API transport, storage, downloads, and Web Crypto digest are test bridges.',
 'Cookie, CSRF, origin, and CSP header behavior is covered by separate native integration tests, not this offline DOM test.',
 'The sample match uses a scripted reference solver; this is not human-subject data or live JEV.']}
(OUT/'dom-smoke.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':len(checks),'failed':0,'runtimeErrors':errors}))

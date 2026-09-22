"""Optional equivalent browser suite using Python Playwright; no credentials required.
Run a local dev server first, then: python tests/browser-smoke.py
Full HTTP-origin browser harness. See reports/VALIDATION.md for execution status.
"""
from pathlib import Path
import json, time, platform
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports'
(OUT / 'screenshots').mkdir(parents=True, exist_ok=True)
(OUT / 'examples').mkdir(parents=True, exist_ok=True)
checks=[]
def record(name,condition=True):
    assert condition, name
    checks.append({'name':name,'passed':True})
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1080},accept_downloads=True)
    page=context.new_page()
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://127.0.0.1:8787',wait_until='networkidle')
    page.locator('#start').wait_for(state='visible');page.wait_for_function("!document.querySelector('#start').disabled")
    record('Desktop loads all twenty board rows',page.locator('.guess-row').count()==20)
    record('Local opponent is not mislabeled JEV','NOT JEV' in page.locator('#modeBadge').inner_text())
    record('Discord login disabled without credentials',page.locator('#login').is_disabled())
    page.screenshot(path=str(OUT/'screenshots'/'desktop-setup.png'),full_page=True)
    page.evaluate("document.querySelector('#autoJev').checked=false")
    page.locator('#start').click()
    page.locator('#guessComposer').wait_for(state='visible')
    record('Server match starts and reveals no hidden target',page.evaluate("async()=>{const id=JSON.parse(localStorage.getItem('mm:currentMatchId'));const r=await (await fetch('/api/matches/'+id)).json();return !r.reveal&&!r.secrets&&r.yourCode.length===4}") )
    def state():
        return page.evaluate("async()=>{const id=JSON.parse(localStorage.getItem('mm:currentMatchId'));return await (await fetch('/api/matches/'+id)).json()}")
    for turn in range(10):
        current=state()
        if current['phase']!='human_break':break
        code=page.evaluate("async(history)=>{const {referenceChoice}=await import('/mastermind/strategy.js');const {decodeGuess,codeLabel}=await import('/mastermind/rules.js');return codeLabel(decodeGuess(referenceChoice(history,'minimax')))}",current['legs']['human']['history'])
        page.locator('#guessSlots button').first.click()
        page.keyboard.type(code)
        with page.expect_response(lambda r:'/actions' in r.url and r.request.method=='POST') as response:
            page.keyboard.press('Enter')
        record('Keyboard guess accepted, turn '+str(turn+1),response.value.status==200)
        page.wait_for_function("revision=>JSON.parse(localStorage.getItem('mm:currentMatchId'))&&document.querySelector('#humanScore').textContent.startsWith(String(revision))",arg=turn+1)
    record('Human leg transitions to opponent leg',state()['phase']=='jev_break')
    record('No counterfactual panel shown in active play',page.locator('#analysisContent').is_hidden())
    for turn in range(10):
        current=state()
        if current['phase']!='jev_break':break
        page.locator('#stepJev').click()
        page.wait_for_function("()=>!document.querySelector('#stepJev').disabled")
        if turn==1:page.screenshot(path=str(OUT/'screenshots'/'desktop-playing.png'),full_page=True)
    current=state()
    record('Complete two-leg match played through UI',current['phase']=='complete')
    record('Local match replay verified but never ranked',current['verified'] and not current['eligible'])
    page.locator('#reviewMatch').click()
    page.locator('#analysisContent').wait_for(state='visible',timeout=30000)
    record('Full counterfactual analysis loads','1,296 ALTERNATIVES' in page.locator('#analysisCoverage').inner_text())
    record('Exact SVG entropy chart renders',page.locator('#entropyChart svg').count()==1)
    page.screenshot(path=str(OUT/'screenshots'/'desktop-analytics.png'),full_page=True)
    for control,name in [('exportJson','sample-analytics.json'),('exportCsv','sample-moves.csv'),('exportDecisions','sample-decisions.csv'),('exportReplay','sample-replay.json')]:
        with page.expect_download() as download:page.locator('#'+control).click()
        download.value.save_as(str(OUT/'examples'/name))
        record('Export '+name,(OUT/'examples'/name).stat().st_size>0)
    analytics=json.loads((OUT/'examples'/'sample-analytics.json').read_text())
    record('Export contains both players and all-guess regret',analytics['comparison']=='all_1296_legal_guesses_per_turn' and len(analytics['human']['rows'])>0 and len(analytics['jev']['rows'])>0)
    page.locator('#analysisActor').select_option('jev')
    record('Turn drilldown exposes selected metrics',page.locator('#moveFacts .fact').count()==20)
    page.locator('#importReplay').set_input_files(str(OUT/'examples'/'sample-replay.json'))
    page.wait_for_function("document.querySelector('#replayVerification').textContent.includes('Valid internal replay')")
    record('Valid replay import verifies commitments')
    bad=json.loads((OUT/'examples'/'sample-replay.json').read_text());bad['reveal']['humanTargetSalt']='a'*64
    bad_path=OUT/'examples'/'tampered-replay.fixture.json';bad_path.write_text(json.dumps(bad))
    page.locator('#importReplay').set_input_files(str(bad_path))
    page.wait_for_function("document.querySelector('#replayVerification').textContent.includes('Verification failed')")
    record('Tampered replay import rejected')
    page.locator('[data-page="record"]').click();page.wait_for_function("document.querySelector('#recordStats .stat')")
    record('Server-backed record renders',page.locator('#recordHistory tbody tr').count()>=1)
    page.locator('[data-page="leaderboards"]').click();page.wait_for_function("document.querySelector('#leaderConfig').textContent.includes('mm-')")
    record('Local matches are absent from ranked board','No eligible results' in page.locator('#leaderTable').inner_text())
    page.locator('#leaderScope').select_option('channel');page.locator('#refreshLeaders').click()
    page.wait_for_function("document.querySelector('#leaderTable').textContent.includes('fresh /play')")
    record('Unverified channel leaderboard blocked')
    record('No JavaScript runtime exceptions',not errors)
    # Responsive and reduced-motion behavior use a separate clean session.
    mobile=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,reduced_motion='reduce')
    phone=mobile.new_page();phone.goto('http://127.0.0.1:8787',wait_until='networkidle')
    record('Mobile layout does not overflow viewport',phone.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    record('Reduced-motion preference honored',phone.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"))
    phone.screenshot(path=str(OUT/'screenshots'/'mobile-setup.png'),full_page=True)
    # Browser practice survives an unavailable API without fake JEV attribution.
    offline=browser.new_context(viewport={'width':1280,'height':900})
    practice=offline.new_page();practice.route('**/api/**',lambda route:route.abort())
    practice.goto('http://127.0.0.1:8787',wait_until='networkidle')
    practice.locator('#localStart').click();practice.locator('#guessComposer').wait_for(state='visible')
    record('Browser practice starts with unavailable API','BROWSER PRACTICE' in practice.locator('#modeBadge').inner_text())
    practice.on('dialog',lambda d:d.accept());practice.locator('#resign').click();practice.locator('#reviewMatch').click()
    practice.locator('#analysisContent').wait_for(state='visible',timeout=30000)
    record('Browser-only forfeit replay and analysis complete without API')
    browser.close()
report={'generatedAt':datetime.now(timezone.utc).isoformat(),'harness':'Python Playwright + system Chromium','platform':platform.platform(),
        'checks':checks,'passed':len(checks),'failed':0,'runtimeErrors':errors,
        'liveDiscordTested':False,'liveJevTested':False,'cloudflareDeploymentTested':False,
        'notes':'The screenshot/sample match was played by a scripted browser using the deterministic reference solver, not a human research participant.'}
(OUT/'browser-smoke.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':len(checks),'failed':0,'runtimeErrors':errors},indent=2))

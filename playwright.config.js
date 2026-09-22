import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests',testMatch:'ui.spec.js',fullyParallel:false,workers:1,
  use:{baseURL:'http://127.0.0.1:8787',viewport:{width:1440,height:1080},trace:'retain-on-failure'},
  webServer:{command:'npm start',url:'http://127.0.0.1:8787/api/health',reuseExistingServer:true,timeout:15000},
  reporter:[['list'],['html',{outputFolder:'playwright-report',open:'never'}]]});

const { chromium } = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({headless: true, channel: 'msedge'});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://localhost:19999/**', r => r.fulfill({contentType: 'text/html', body: `<!doctype html><html><body>
  <div id="txt2img_prompt_row" style="display:flex"><div id="txt2img_prompt"><textarea>original</textarea></div></div>
  <div id="img2img_prompt_row" style="display:flex"><div id="img2img_prompt"><textarea></textarea></div></div>
  <button id="generate">Generate</button><script>
  window.sent=[];window.bound='original';document.querySelector('#txt2img_prompt textarea').addEventListener('input',e=>window.bound=e.target.value);
  document.querySelector('#generate').onclick=()=>window.sent.push(window.bound);
  </script></body></html>`}));
  async function init() { await page.goto('http://localhost:19999'); await page.addStyleTag({path:path.join(base,'style.css')}); await page.addScriptTag({path:path.join(base,'javascript/positivePromptTabs.js')}); }
  await init();
  const root = page.locator('.ppt-root').first();
  const area = page.locator('#txt2img_prompt textarea');
  const tab = name => root.getByRole('tab', {name, exact:true});
  const menu = name => root.getByRole('button',{name:`${name}の操作`,exact:true});
  assert.equal(await root.getByRole('tab').count(), 3);
  await area.fill('A 日本語 🌸'); await tab('タブ2').click(); await area.fill('B');
  await page.locator('#generate').click(); await tab('タブ1').click();
  assert.equal(await area.inputValue(),'A 日本語 🌸');
  assert.deepEqual(await page.evaluate(()=>sent),['B']);
  await menu('タブ1').click(); await root.getByRole('button',{name:'複製',exact:true}).click();
  assert.equal(await area.inputValue(),'A 日本語 🌸');
  await area.fill('copy'); await tab('タブ1').click(); assert.equal(await area.inputValue(),'A 日本語 🌸');
  await menu('タブ1 コピー').click(); await root.getByRole('button',{name:'名前を変更',exact:true}).click();
  await root.getByRole('textbox',{name:'タブ名'}).fill('<人物A>'); await root.getByRole('textbox',{name:'タブ名'}).press('Enter');
  assert.equal(await tab('<人物A>').count(),1);
  await menu('<人物A>').click(); await root.getByRole('button',{name:'削除',exact:true}).click();
  await root.locator('.ppt-row').getByRole('button',{name:'最後に削除したタブを復元',exact:true}).click(); assert.equal(await area.inputValue(),'copy');
  await menu('<人物A>').click(); await root.getByRole('button',{name:'左へ移動',exact:true}).click();
  assert.equal(await root.getByRole('tab').first().textContent(),'<人物A>');
  // Exercise actual mouse drag, including both directions and text preservation.
  const dropItem = tab('タブ3').locator('..');
  const dropBounds = await dropItem.boundingBox();
  await tab('<人物A>').dragTo(dropItem, {targetPosition:{x:dropBounds.width-3,y:12}});
  assert.equal(await root.getByRole('tab').last().textContent(),'<人物A>');
  await tab('<人物A>').dragTo(tab('タブ1'), {targetPosition:{x:3,y:12}});
  assert.equal(await root.getByRole('tab').first().textContent(),'<人物A>');
  assert.equal(await area.inputValue(),'copy');
  await root.getByRole('button',{name:'タブを追加',exact:true}).click(); assert.equal(await area.inputValue(),'');
  await area.fill('persist');
  await init(); assert.equal(await area.inputValue(),'persist');
  assert.equal(await root.getByRole('tab').first().textContent(),'<人物A>');
  assert.equal(await page.locator('#img2img_prompt textarea').inputValue(),'');
  // External extensions / PNG transfer modify the existing field.
  await area.evaluate(el=>{el.value='external';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await tab('タブ1').click(); await tab('タブ4').click(); assert.equal(await area.inputValue(),'external');
  while(await root.getByRole('tab').count()>1) {
    const name=await root.getByRole('tab').first().textContent(); await menu(name).click(); await root.getByRole('button',{name:'削除',exact:true}).click();
  }
  const last=await root.getByRole('tab').first().textContent(); await menu(last).click();
  assert.equal(await root.getByRole('button',{name:'削除',exact:true}).isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: tab isolation, generation snapshot, duplicate, rename, delete/restore, reorder, add, reload, mode isolation, external input, last-tab guard.');
  if (!process.env.PPT_NEO_URL) { await browser.close(); return; }
  // Inspect the actual Neo page in a separate browser context, without generating images.
  const live = await browser.newPage();
  live.on('pageerror', e => console.log('NEO page error:', e.message));
  await live.goto(process.env.PPT_NEO_URL, {waitUntil:'domcontentloaded',timeout:60000});
  await live.locator('#txt2img_prompt textarea').waitFor({timeout:60000});
  await live.addStyleTag({path:path.join(base,'style.css')});
  await live.addScriptTag({path:path.join(base,'javascript/positivePromptTabs.js')});
  const liveRoot=live.locator('.ppt-root').first();
  assert.equal(await live.locator('.ppt-root').count(),2);
  await live.locator('#txt2img_prompt textarea').fill('PPT test A');
  await liveRoot.getByRole('tab',{name:'タブ2',exact:true}).click();
  await live.locator('#txt2img_prompt textarea').fill('PPT test B');
  await liveRoot.getByRole('tab',{name:'タブ1',exact:true}).click();
  assert.equal(await live.locator('#txt2img_prompt textarea').inputValue(),'PPT test A');
  const bounds = await liveRoot.boundingBox();
  const fieldBounds = await live.locator('#txt2img_prompt textarea').boundingBox();
  assert.ok(bounds.y + bounds.height <= fieldBounds.y + 2, 'Tabs must be above prompt');
  assert.ok(fieldBounds.y - (bounds.y + bounds.height) <= 4, 'Tabs attach directly to prompt');
  assert.ok(fieldBounds.width > bounds.width * .9, 'Prompt retains its width');
  await liveRoot.getByRole('tab',{name:'タブ1',exact:true}).focus();
  await live.screenshot({path:path.join(base,'tests/neo-preview.png')});
  let submitted;
  // Stop the generation request at the browser boundary; never queue GPU work.
  await live.route('**/queue/join**', async route => {
    const body=route.request().postDataJSON();
    if (body?.data?.length > 50 && body.data.includes('PPT test A')) submitted=body;
    await route.fulfill({status:503,contentType:'application/json',body:'{"detail":"PPT browser test: blocked intentionally"}'});
  });
  await live.locator('#txt2img_generate').click();
  await liveRoot.getByRole('tab',{name:'タブ2',exact:true}).click();
  await live.waitForFunction(()=>document.querySelector('#txt2img_prompt textarea').value==='PPT test B');
  for (let n=0;n<40 && !submitted;n++) await new Promise(r=>setTimeout(r,100));
  assert.ok(submitted, 'Actual Neo generation payload contains clicked tab A');
  assert.ok(!submitted.data.includes('PPT test B'), 'Later tab switch cannot change request');
  await liveRoot.getByRole('tab',{name:'タブ1',exact:true}).click();
  console.log('PASS: real Neo DOM mount, layout, prompt switching, captured generation request A despite later switch to B. No GPU generation performed.');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});

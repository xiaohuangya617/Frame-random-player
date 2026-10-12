const fs = require('fs');
const path = require('path');

for (const stream of [process.stdout, process.stderr]) {
  if (stream && stream.on) stream.on('error', err => {
    if (err.code !== 'EPIPE') process.exitCode = 1;
  });
}

module.exports = async ({ app, win, DATA_DIR }) => {
  const results = [];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const js = code => win.webContents.executeJavaScript(code, true);
  const dataFile = path.join(DATA_DIR, 'data.json');
  const dataKey = path.resolve(dataFile).toLowerCase();
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    (ok ? console.log : console.error)(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  };
  const diskTags = () => {
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return data.categories[0].videos[0].tags || [];
  };
  const withCommitOutcomes = async (outcomes, action) => {
    const realRename = fs.renameSync;
    let commitIndex = 0;
    fs.renameSync = (source, target) => {
      if (path.resolve(target).toLowerCase() === dataKey && commitIndex < outcomes.length) {
        const succeeds = outcomes[commitIndex++];
        if (!succeeds) {
          const error = new Error(`合成第 ${commitIndex} 次最终提交失败`);
          error.code = 'EACCES';
          throw error;
        }
      }
      return realRename(source, target);
    };
    try {
      const value = await action();
      return { value, commitCount: commitIndex };
    } finally {
      fs.renameSync = realRename;
    }
  };

  try {
    for (let i = 0; i < 100; i++) {
      if (await js("typeof S!=='undefined'&&document.readyState==='complete'").catch(() => false)) break;
      await sleep(100);
    }
    await sleep(300);

    const videoPath = path.join(DATA_DIR, 'queue.mp4');
    fs.writeFileSync(videoPath, 'queue');
    const baseline = await js(`(async()=>{
      const video=normalizeVideoMeta({id:'queue-video',name:'queue.mp4',path:${JSON.stringify(videoPath)},tags:[]});
      const category={id:'queue-category',name:'事务队列',type:'collection',roots:[],videos:[video],videoMetas:[video],currentPool:[video],order:0,permissionRestored:true};
      S.categories=[category];S.activeCategoryId=category.id;S.currentVideo=video;S.settings.tags=['T'];
      const saved=await persistAllNow();return saved.ok;
    })()`);
    check('5.7 连续事务基线保存成功', baseline && diskTags().length === 0, JSON.stringify({ baseline, disk: diskTags() }));

    const cases = [
      { name: '失败/失败', outcomes: [false, false], expected: [] },
      { name: '失败/成功', outcomes: [false, true], expected: ['T'] },
      { name: '成功/失败', outcomes: [true, false], expected: ['T'] },
      { name: '成功/成功', outcomes: [true, true], expected: [] }
    ];

    for (const item of cases) {
      await js(`(async()=>{const video=S.categories[0].videos[0];video.tags=[];await persistAllNow();$('toastContainer').innerHTML='';return true})()`);
      const run = await withCommitOutcomes(item.outcomes, () => js(`(async()=>{
        const video=S.categories[0].videos[0];
        const first=toggleVideoTag(video,'T');
        const second=toggleVideoTag(video,'T');
        const busyDuring=document.body.classList.contains('persist-action-busy')&&document.body.getAttribute('aria-busy')==='true';
        await Promise.all([first,second]);
        return {tags:[...video.tags],busyDuring,busyAfter:document.body.classList.contains('persist-action-busy'),toast:$('toastContainer').textContent};
      })()`));
      const memory = run.value.tags;
      const disk = diskTags();
      const expected = JSON.stringify(item.expected);
      check(
        `连续标签提交 ${item.name} 保持内存磁盘一致`,
        run.commitCount === 2 && JSON.stringify(memory) === expected && JSON.stringify(disk) === expected &&
          run.value.busyDuring && !run.value.busyAfter,
        JSON.stringify({ ...run.value, disk, commitCount: run.commitCount })
      );
    }

    fs.writeFileSync(path.join(DATA_DIR, 'v5_7-resilience-result.json'), JSON.stringify(results, null, 2), 'utf8');
    const failed = results.filter(item => !item.ok).length;
    console.log(`5.7 稳定性专项结束: ${results.length - failed}/${results.length} 通过`);
    app.exit(failed ? 1 : 0);
  } catch (error) {
    console.error('[5.7 稳定性专项异常]', error.stack || error);
    try {
      fs.writeFileSync(path.join(DATA_DIR, 'v5_7-resilience-result.json'), JSON.stringify({ results, error: error.stack || String(error) }, null, 2));
    } catch { /* 忽略 */ }
    app.exit(2);
  }
};

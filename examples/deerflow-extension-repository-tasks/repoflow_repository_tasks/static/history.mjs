export function mountHistory(root, context, call, t) {
  let disposed = false;
  let page = 1;
  let busy = false;
  let revision = 0;
  const add = (parent,tag,text) => {const node=document.createElement(tag);if(text)node.textContent=text;parent.append(node);return node;};
  const panel = add(root,'div');
  const status = add(panel,'p');status.setAttribute('role','status');
  const list = add(panel,'ol');list.className='repo-history';
  const more = add(panel,'button',t('读取修改记录','Load change history'));more.type='button';
  const diff = add(panel,'pre');diff.className='repo-pr-preview';
  async function load() {
    if(busy || page===null)return;
    busy=true;more.disabled=true;
    try {
      const data=await call('history',{page});
      if(disposed || context.signal.aborted)return;
      status.textContent=t('本地 Git 检查点：','Local Git checkpoints: ')+data.total;
      for(const entry of data.entries){
        const row=add(list,'li');
        const stage=entry.stage==='turn_start'?t('本轮开始前','Before this turn'):entry.stage==='turn_end'?t('本轮结束','After this turn'):entry.stage;
        add(row,'p',new Date(entry.time).toLocaleString(context.locale)+' · '+stage);
        if(entry.error){add(row,'p',t('此步 Git 记录失败，请检查审阅。','Git checkpoint failed for this step. Inspect the review.'));continue;}
        const view=add(row,'button',entry.commit.slice(0,12)+' · '+entry.file_count+t(' 个文件',' files'));view.type='button';
        add(row,'small',entry.files.join('、'));
        view.onclick=async()=>{
          const expected=++revision;view.disabled=true;
          try{const data=await call('history-diff',{commit:entry.commit});if(!disposed && !context.signal.aborted && expected===revision)diff.textContent=data.diff;}
          catch{if(!disposed)status.textContent=t('无法读取此检查点。','Could not load this checkpoint.');}
          finally{view.disabled=false;}
        };
      }
      page=data.next_page;more.hidden=page===null;
      if(!data.total)status.textContent=t('还没有修改检查点；原始 Git 基准仍保留。','No change checkpoints yet; the original Git baseline is retained.');
    }catch{if(!disposed)status.textContent=t('无法读取修改记录，请重试。','Could not load change history. Retry.');}
    finally{busy=false;more.disabled=false;}
  }
  more.onclick=load;void load();
  return{dispose(){disposed=true;revision++;panel.remove();}};
}

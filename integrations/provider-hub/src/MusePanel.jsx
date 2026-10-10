import React, {useEffect,useState} from 'react';
async function call(action,data={}) {
  const response=await fetch('/api/bc-muse',{credentials:'same-origin',...action ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...data})} : {}});
  const value=await response.json();if(!response.ok)throw Error(value.error||'Muse request failed');return value;
}
function Questions({prompt,onAnswer,busy}) {
  const [answers,setAnswers]=useState({});
  return <form onSubmit={event=>{event.preventDefault();onAnswer(prompt.userInputId,prompt.questions.map(question=>({questionId:question.id,...answers[question.id]})));}}>
    {prompt.questions.map(question=><fieldset key={question.id} disabled={busy}><legend>{question.question}</legend>
      {question.options?.length>0 && <select aria-label={question.header||question.question} multiple={question.selection?.mode==='multiple'} value={answers[question.id]?.selectedLabels||answers[question.id]?.selectedLabel||''} onChange={event=>setAnswers({...answers,[question.id]:question.selection?.mode==='multiple'?{selectedLabels:[...event.target.selectedOptions].map(option=>option.value)}:{selectedLabel:event.target.value}})}><option value="">Choose an answer</option>{question.options.map(option=><option key={option.label} value={option.label}>{option.label}</option>)}</select>}
      <label className="ph-field">Your answer<input maxLength={500} value={answers[question.id]?.freeText||''} onChange={event=>setAnswers({...answers,[question.id]:{freeText:event.target.value}})}/></label>
    </fieldset>)}
    <button disabled={busy||prompt.questions.some(question=>!answers[question.id])} type="submit">Send answers</button>
  </form>;
}
/** User-owned Muse session, with permissions decided by the user through MSP. */
export function MusePanel() {
  const [view,setView]=useState(null),[cwd,setCwd]=useState(''),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;const refresh=()=>call().then(next=>{if(active)setView(next);}).catch(error=>{if(active)setError(error.message);});void refresh();const timer=setInterval(refresh,1000);return()=>{active=false;clearInterval(timer);};},[]);
  const run=async(action,data)=>{setBusy(true);setError('');try{setView(await call(action,data));if(action==='send')setText('');}catch(error){setError(error.message);}finally{setBusy(false);}};
  return <section className="ph-muse" aria-label="Muse subscription">
    <h3>Muse subscription</h3><p>Uses the installed Muse Code CLI and its own signed-in subscription. Sign in once, select a workspace, then connect. Muse keeps its tools and permission prompts.</p>
    <button disabled={busy||view?.login?.running} onClick={()=>run('login')}>Sign in with Muse</button>
    {view?.login?.output && <pre className="ph-cli-output">{view.login.output}</pre>}
    <label className="ph-field">Workspace<select disabled={busy||view?.sessionId} value={cwd} onChange={event=>setCwd(event.target.value)}><option value="">Select a workspace</option>{view?.workspaces?.map(workspace=><option key={workspace.path} value={workspace.path}>{workspace.title}</option>)}</select></label>
    {!view?.sessionId ? <button disabled={busy||!cwd} onClick={()=>run('connect',{cwd})}>Connect Muse CLI</button> : <button disabled={busy} onClick={()=>run('close')}>Disconnect</button>}
    <p role="status">{view?.status||'Loading…'}</p>
    {view?.items?.map(item=><article key={item.itemId}><strong>{item.kind==='userMessage'?'You':item.kind==='agentMessage'?'Muse':item.toolName||item.kind}</strong><pre>{String(item.text||item.output||item.fallbackText||item.status||'')}</pre></article>)}
    {view?.approvals?.map(prompt=><section key={prompt.approvalId} aria-label="Muse permission request"><p>{prompt.subject?.summary||prompt.toolName||'Muse requests permission'}</p><pre>{prompt.rawArgs}</pre>{prompt.availableChoices?.map(choice=><button key={choice.choiceId} disabled={busy} onClick={()=>run('decide',{approvalId:prompt.approvalId,choiceId:choice.choiceId})}>{choice.label}</button>)}</section>)}
    {view?.questions?.map(prompt=><Questions key={prompt.userInputId} prompt={prompt} busy={busy} onAnswer={(userInputId,answers)=>run('answer',{userInputId,answers})}/>)}
    {view?.sessionId && <form onSubmit={event=>{event.preventDefault();void run('send',{text});}}><label className="ph-field">Message Muse<textarea maxLength={32768} value={text} onChange={event=>setText(event.target.value)}/></label><button disabled={busy||!text.trim()} type="submit">Send</button><button disabled={busy||!view.turnId} type="button" onClick={()=>run('cancel')}>Stop</button></form>}
    {(error||view?.error)&&<p role="alert">{error||view.error}</p>}
  </section>;
}

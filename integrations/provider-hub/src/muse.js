import { Connection } from '@muse-code/sdk';
import { isAbsolute } from 'node:path';

/** Drives the official Muse CLI over MSP; subscription credentials stay with Muse. */
export class MuseBridge {
  constructor(subprocess, { command = 'muse', args = ['serve'], timeoutMs = 20000 } = {}) {
    this.subprocess = subprocess; this.command = command; this.args = args; this.timeoutMs = timeoutMs;
    this.items = new Map(); this.approvals = new Map(); this.questions = new Map(); this.status = 'disconnected';
  }
  snapshot() {
    return { status:this.status, sessionId:this.sessionId, turnId:this.turnId, error:this.error,
      items:[...this.items.values()].slice(-100), approvals:[...this.approvals.values()], questions:[...this.questions.values()] };
  }
  async connect(cwd) {
    if (this.child) throw Error('Disconnect the current Muse session first.');
    if (!isAbsolute(cwd)) throw Error('Select an absolute workspace folder.');
    this.status='connecting'; this.error=undefined;
    const child = this.subprocess.spawn({argv:[this.command,...this.args], cwd, graceMs:2000,
      stdio:{stdin:'pipe',stdout:'pipe',stderr:{maxBytes:8192}}});
    this.child=child; child.stdout.setEncoding('utf8');
    const connection = new Connection({incoming:child.stdout,
      write:chunk => new Promise((resolve,reject) => child.stdin.write(chunk, error => error ? reject(error) : resolve())),
      close:async flushed => {await flushed; child.stdin.end(); child.terminate(); await child.done;},
    }, {frameLimitBytes:1024*1024});
    this.connection=connection;
    connection.onNotification(event => this.observe(event));
    connection.onProtocolError(() => {this.status='error';this.error='Muse protocol connection failed. Reconnect to continue.';});
    child.done.then(() => {if(this.child===child && this.status!=='disconnected') this.status='disconnected';}, () => {if(this.child===child){this.status='error';this.error='Muse CLI could not start. Install Muse and sign in, then reconnect.';}});
    try {
      await this.bounded(connection.request('initialize',{clientInfo:{name:'bharatcode',version:'0.1.0'}}));
      connection.notify('initialized',{});
      const result = await this.bounded(connection.command('session/start',{workspaceRoot:cwd,approvalMode:'onRequest'},{maxAttempts:1}));
      this.sessionId=result.session.sessionId; this.status='ready'; return this.snapshot();
    } catch(error) {await this.close();throw error;}
  }
  observe({method,params:p={}}) {
    if (p.sessionId && this.sessionId && p.sessionId!==this.sessionId) return;
    if (method==='item/started'||method==='item/completed'||method==='item/updated') {
      const item=p.item;
      if(item?.itemId){this.items.set(item.itemId,item);while(this.items.size>100)this.items.delete(this.items.keys().next().value);}
    }
    if(method==='item/delta') {
      const previous=this.items.get(p.itemId)||{itemId:p.itemId,kind:'agentMessage'};
      const field=p.field||'text';
      if(['text','output'].includes(field)) this.items.set(p.itemId,{...previous,[field]:(String(previous[field]||'')+String(p.delta||'')).slice(-65536)});
    }
    if(method==='approval/requested'||method==='approval/updated') this.approvals.set(p.approvalId,{...this.approvals.get(p.approvalId),...p});
    if(method==='approval/resolved') this.approvals.delete(p.approvalId);
    if(method==='userInput/requested') this.questions.set(p.userInputId,p);
    if(method==='userInput/settled') this.questions.delete(p.userInputId);
    if(method==='turn/started'){this.turnId=p.turnId;this.status='running';}
    if(method==='turn/completed'){this.status='ready';this.turnId=undefined;}
  }
  async bounded(promise) {let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Muse did not respond. Reconnect and try again.')),this.timeoutMs);})]);}finally{clearTimeout(timer);}}
  async send(text) {
    if(!this.sessionId||!this.connection)throw Error('Connect Muse first.');
    if(typeof text!=='string'||!text.trim()||text.length>32768)throw Error('Enter a prompt of up to 32,768 characters.');
    const ack=await this.bounded(this.connection.command('turn/start',{sessionId:this.sessionId,input:[{type:'text',text}]},{maxAttempts:1}));
    this.turnId=ack.turnId;return this.snapshot();
  }
  async cancel() {
    if(this.turnId)await this.bounded(this.connection.command('turn/cancel',{sessionId:this.sessionId,turnId:this.turnId},{maxAttempts:1}));
    return this.snapshot();
  }
  async decide(approvalId,choiceId) {
    const prompt=this.approvals.get(approvalId);
    if(!prompt||!prompt.availableChoices?.some(choice=>choice.choiceId===choiceId))throw Error('That permission choice is no longer available.');
    await this.bounded(this.connection.command('approval/decide',{sessionId:this.sessionId,approvalId,requirementId:prompt.currentRequirementId,choiceId},{maxAttempts:1}));return this.snapshot();
  }
  async answer(userInputId,answers) {
    if(!this.questions.has(userInputId)||!Array.isArray(answers)||JSON.stringify(answers).length>8192)throw Error('That question is no longer available.');
    await this.bounded(this.connection.command('userInput/answer',{sessionId:this.sessionId,userInputId,answers},{maxAttempts:1}));return this.snapshot();
  }
  async close() {
    const connection=this.connection,child=this.child;this.connection=undefined;this.child=undefined;
    this.sessionId=undefined;this.turnId=undefined;this.items.clear();this.approvals.clear();this.questions.clear();this.status='disconnected';
    if(connection)await connection.close().catch(()=>{});else if(child){child.terminate();await child.done.catch(()=>{});}return this.snapshot();
  }
}

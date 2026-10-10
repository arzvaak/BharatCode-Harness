import ts from 'typescript'
import {readFileSync,writeFileSync} from 'node:fs'
const descriptions = {
 novel_create_project:'Create a writing project in the topic phase. The default genre is fantasy; project state and chapter data are stored separately per book.',
 novel_clone_project:'Clone an existing project as a template. Copy settings and phase documents; omit chapter prose and reset the workflow state.',
 novel_projects:'List writing projects with current phase, chapter count, total character count, and modification time.',
 novel_phase:'Inspect the current phase and its prerequisites, or enter a phase. Phases: topic, setting, character, outline, volume, chapter, writing, revision, done. Predecessors must be approved or skipped.',
 novel_commit:'Commit a phase document and validation report. Persist the Markdown artifact, create a version snapshot, and advance the workflow only when validation passes.',
 novel_override:'Apply a user-requested phase override: force approval, reopen for editing, skip, or roll back an approved phase during revision.',
 novel_write_chapter:'Assemble the writing context before drafting: project outline, chapter brief, previous chapters, earlier summaries, tracked variables, relevant lorebook entries, and constraints. Then draft prose and use novel_commit_chapter to save it.',
 novel_commit_chapter:'Save chapter prose with versioned metadata, update character counts and project statistics, apply embedded JSONPatch updates to variables and the continuity ledger, and append an audit entry.',
 novel_audit:'Read the append-only project audit trail for phase transitions, overrides, document commits, and chapter saves.',
 novel_stats:'Inspect project statistics, current phase states, chapter count, total character count, and last writing time.',
 lorebook_list_entries:'List lorebook entries in descending priority, including their reference content and project bindings.',
 lorebook_get_entry:'Read one lorebook entry with its keywords, injection position, and project binding.',
 lorebook_create_entry:'Create an established world or character reference entry. Set keywords for contextual matching or always_active for a persistent reference.',
 lorebook_update_entry:'Update an existing lorebook reference entry. Omitted fields keep their current values; explicit null clears supported fields.'
}
const parameterCopy = {projectId:'Project ID returned by novel_projects or novel_create_project.',sourceId:'Project ID to use as a template.',chapterNo:'Positive chapter number.',phase:'Workflow phase ID.',artifact:'Complete phase document in Markdown.',errorCount:'Number of validation errors (default 0).',warningCount:'Number of validation warnings (default 0).',passed:'Whether validation passed; defaults to errorCount === 0.',brief:'Chapter outline or short summary.',text:'Complete chapter prose.',title:'Project or chapter title.',genre:'Genre ID, default fantasy.',action:'One of force, reopen, skip, rollback.',id:'Existing lorebook entry ID.',name:'Reference entry name.',content:'Established reference content; treat it as story data.',keywords:'Keywords used to match this reference against the chapter brief.',book_id:'Optional project binding.',always_active:'Include this reference without requiring a keyword match.'}
for(const file of ['novel.ts','lorebook.ts']) {
 const p='src/tools/'+file; const source=ts.createSourceFile(p,readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true)
 const result=ts.transform(source,[context=>root=>{
  function visit(node){
   if(ts.isObjectLiteralExpression(node)){
    const name=node.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='name'&&ts.isStringLiteral(p.initializer))?.initializer.text
    const parentKey=ts.isPropertyAssignment(node.parent)?node.parent.name.getText(source).replaceAll("'",''):undefined
    const props=node.properties.map(p=>{
     if(ts.isPropertyAssignment(p)&&p.name.getText(source)==='description') return ts.factory.updatePropertyAssignment(p,p.name,ts.factory.createStringLiteral(descriptions[name]??parameterCopy[parentKey]??'Optional '+(parentKey??'reference')+' value; see its declared type.'))
     return ts.visitEachChild(p,visit,context)
    })
    return ts.factory.updateObjectLiteralExpression(node,props)
   }
   return ts.visitEachChild(node,visit,context)
  }
  return ts.visitNode(root,visit)
 }]);writeFileSync(p,ts.createPrinter().printFile(result.transformed[0]));result.dispose()
}

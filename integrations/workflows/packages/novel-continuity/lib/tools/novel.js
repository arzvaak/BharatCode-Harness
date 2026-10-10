import { defineTool } from '@deepseek-ai/dsh-tools';
import { asResult } from "../core/lorebook/service.js";
import { jsonOutput } from "./json.js";
function asJson(value) {
    return JSON.parse(JSON.stringify(value));
}
export function registerNovelDomainTools(ctx, deps) {
    const { novel } = deps;
    return [
        ctx.tools.register(defineTool({
            name: 'novel_create_project',
            description: "Create a writing project in the topic phase. The default genre is fantasy; project state and chapter data are stored separately per book.",
            parameters: {
                title: { type: 'string', required: true, description: "Project or chapter title." },
                genre: { type: 'string', description: "Genre ID, default fantasy." }
            },
            output: jsonOutput(),
            execute: async (rawArgs) => {
                const args = rawArgs;
                return asJson(await asResult(() => novel.createProject(String(args.title ?? '').trim(), String(args.genre ?? 'fantasy').trim() || 'fantasy')));
            },
            isConcurrencySafe: () => true
        })),
        ctx.tools.register(defineTool({
            name: 'novel_clone_project',
            description: "Clone an existing project as a template. Copy settings and phase documents; omit chapter prose and reset the workflow state.",
            parameters: {
                sourceId: { type: 'string', required: true, description: "Project ID to use as a template." },
                title: { type: 'string', description: "Project or chapter title." },
                genre: { type: 'string', description: "Genre ID, default fantasy." }
            },
            output: jsonOutput(),
            execute: async (rawArgs) => {
                const args = rawArgs;
                return asJson(await asResult(() => novel.cloneProject(args.sourceId, { title: args.title, genre: args.genre })));
            },
            isConcurrencySafe: () => true
        })),
        ctx.tools.register(defineTool({
            name: 'novel_projects',
            description: "List writing projects with current phase, chapter count, total character count, and modification time.",
            parameters: {},
            output: jsonOutput(),
            execute: async () => asJson(await asResult(() => novel.listProjects())),
            isConcurrencySafe: () => true
        })),
        ctx.tools.register(defineTool({
            name: 'novel_phase',
            description: "Inspect the current phase and its prerequisites, or enter a phase. Phases: topic, setting, character, outline, volume, chapter, writing, revision, done. Predecessors must be approved or skipped.",
            parameters: {
                projectId: { type: 'string', required: true, description: "Project ID returned by novel_projects or novel_create_project." },
                phase: { type: 'string', description: "Workflow phase ID." }
            },
            output: jsonOutput(),
            execute: async (rawArgs) => {
                const args = rawArgs;
                return asJson(await asResult(async () => {
                    if (args.phase) {
                        const book = await novel.enterPhase(args.projectId, args.phase);
                        return { book, entered: args.phase };
                    }
                    const book = await novel.load(args.projectId);
                    return { book };
                }));
            },
            isConcurrencySafe: () => true
        })),
        ctx.tools.register(defineTool({
            name: 'novel_commit',
            description: "Commit a phase document and validation report. Persist the Markdown artifact, create a version snapshot, and advance the workflow only when validation passes.",
            parameters: {
                projectId: { type: 'string', required: true, description: "Project ID returned by novel_projects or novel_create_project." },
                phase: { type: 'string', required: true, description: "Workflow phase ID." },
                artifact: { type: 'string', required: true, description: "Complete phase document in Markdown." },
                errorCount: { type: 'number', description: "Number of validation errors (default 0)." },
                warningCount: { type: 'number', description: "Number of validation warnings (default 0)." },
                passed: { type: 'boolean', description: "Whether validation passed; defaults to errorCount === 0." }
            },
            output: jsonOutput(),
            execute: async (rawArgs) => {
                const args = rawArgs;
                const errorCount = args.errorCount ?? 0;
                return asJson(await asResult(() => novel.commitPhase(args.projectId, args.phase, args.artifact, { passed: args.passed ?? errorCount === 0, errorCount, warningCount: args.warningCount ?? 0 })));
            },
            isConcurrencySafe: () => true
        })),
        ctx.tools.register(defineTool({
            name: 'novel_override',
            description: "Apply a user-requested phase override: force approval, reopen for editing, skip, or roll back an approved phase during revision.",
            parameters: {
                projectId: { type: 'string', required: true, description: "Project ID returned by novel_projects or novel_create_project." },
                phase: { type: 'string', required: true, description: "Workflow phase ID." },
                action: { type: 'string', required: true, description: "One of force, reopen, skip, rollback." }
            },
            output: jsonOutput(),
            execute: async (rawArgs) => {
                const args = rawArgs;
                return asJson(await asResult(() => novel.overridePhase(args.projectId, args.phase, args.action)));
            },
            isConcurrencySafe: () => true
        })),
        ctx.tools.register(defineTool({
            name: 'novel_write_chapter',
            description: "Assemble the writing context before drafting: project outline, chapter brief, previous chapters, earlier summaries, tracked variables, relevant lorebook entries, and constraints. Then draft prose and use novel_commit_chapter to save it.",
            parameters: {
                projectId: { type: 'string', required: true, description: "Project ID returned by novel_projects or novel_create_project." },
                chapterNo: { type: 'number', required: true, description: "Positive chapter number." },
                brief: { type: 'string', description: "Chapter outline or short summary." }
            },
            output: jsonOutput(),
            execute: async (rawArgs) => {
                const args = rawArgs;
                return asJson(await asResult(() => novel.assemble(args.projectId, args.chapterNo, args.brief)));
            },
            isConcurrencySafe: () => true
        })),
        ctx.tools.register(defineTool({
            name: 'novel_commit_chapter',
            description: "Save chapter prose with versioned metadata, update character counts and project statistics, apply embedded JSONPatch updates to variables and the continuity ledger, and append an audit entry.",
            parameters: {
                projectId: { type: 'string', required: true, description: "Project ID returned by novel_projects or novel_create_project." },
                chapterNo: { type: 'number', required: true, description: "Positive chapter number." },
                title: { type: 'string', required: true, description: "Project or chapter title." },
                text: { type: 'string', required: true, description: "Complete chapter prose." },
                brief: { type: 'string', description: "Chapter outline or short summary." }
            },
            output: jsonOutput(),
            execute: async (rawArgs) => {
                const args = rawArgs;
                return asJson(await asResult(async () => {
                    const chapter = await novel.saveChapter(args.projectId, args.chapterNo, args.title, args.text, args.brief);
                    const stats = await novel.chapterStats(args.projectId, args.chapterNo);
                    return { chapter, stats };
                }));
            },
            isConcurrencySafe: () => true
        })),
        ctx.tools.register(defineTool({
            name: 'novel_audit',
            description: "Read the append-only project audit trail for phase transitions, overrides, document commits, and chapter saves.",
            parameters: {
                projectId: { type: 'string', required: true, description: "Project ID returned by novel_projects or novel_create_project." }
            },
            output: jsonOutput(),
            execute: async (rawArgs) => asJson(await asResult(() => novel.audit(rawArgs.projectId))),
            isConcurrencySafe: () => true
        })),
        ctx.tools.register(defineTool({
            name: 'novel_stats',
            description: "Inspect project statistics, current phase states, chapter count, total character count, and last writing time.",
            parameters: {
                projectId: { type: 'string', required: true, description: "Project ID returned by novel_projects or novel_create_project." }
            },
            output: jsonOutput(),
            execute: async (rawArgs) => {
                const projectId = rawArgs.projectId;
                return asJson(await asResult(async () => {
                    const book = await novel.load(projectId);
                    return {
                        id: book.id,
                        title: book.title,
                        genre: book.genre,
                        status: book.status,
                        currentPhase: book.currentPhase,
                        stats: book.stats,
                        phases: book.phases
                    };
                }));
            },
            isConcurrencySafe: () => true
        })),
    ];
}

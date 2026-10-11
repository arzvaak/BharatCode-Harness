/** Writing briefs and fiction material share the project's durable revision journal. */
import { useLayoutEffect, useRef, useState } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkflowPayload, WorkflowRecord } from '@deepseek-ai/dsh-workspace/types'
import { DocumentPanel, type DocumentPanelProps } from './DocumentPanel.tsx'
import type { WorkspaceSurfaceActions } from './surfaces.ts'
import css from './surfaces.module.css'
type Writing = Extract<WorkflowPayload, { kind: 'writing' }>
const empty: Writing = {
  kind: 'writing',
  specialization: 'general',
  brief: '',
  style: '',
  outline: [],
  canon: [],
  tentative: [],
  characters: [],
  chronology: [],
  scenes: [],
  sourceIds: [],
}
export function WritingWorkspace(props: DocumentPanelProps & WorkspaceSurfaceActions & { project?: WorkspaceView | undefined }) {
  const generation = useRef(0)
  const [record, setRecord] = useState<WorkflowRecord>()
  const [draft, setDraft] = useState<Writing>(empty)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [sourcePaths, setSourcePaths] = useState('')
  const [consultation, setConsultation] = useState('continuity')
  const [structure, setStructure] = useState(false)
  useLayoutEffect(() => {
    ++generation.current
    let active = true
    setRecord(undefined)
    setDraft(empty)
    setError(undefined)
    setBusy(false)
    if (props.project !== undefined)
      void props.workflowRecords?.(props.project.workspaceId).then(
        (records) => {
          if (active) {
            const value = records.find(value => value.id === 'writing-project')
            setRecord(value)
            if (value?.payload.kind === 'writing') setDraft(value.payload)
          }
        },
        (reason: unknown) => {
          if (active) setError(String(reason))
        },
      )
    return () => {
      active = false
      ++generation.current
    }
  }, [props.project?.workspaceId, props.workflowRecords])
  const save = (): void => {
    if (props.project === undefined || props.saveWorkflowRecord === undefined) return
    const epoch = generation.current
    setBusy(true)
    setError(undefined)
    void props
      .saveWorkflowRecord({
        id: 'writing-project',
        projectId: props.project.workspaceId,
        title: props.project.title,
        expectedRevision: record?.revision ?? null,
        payload: draft,
      })
      .then(
        (value) => {
          if (generation.current === epoch) setRecord(value)
        },
        (reason: unknown) => {
          if (generation.current === epoch) setError(String(reason))
        },
      )
      .finally(() => {
        if (generation.current === epoch) setBusy(false)
      })
  }
  const exportBrief = (): void => {
    const content = `# ${props.project?.title ?? ''}\n\n${draft.brief}\n\n## Style\n${draft.style}\n\n## Outline\n${draft.outline.map(value => `- ${value}`).join('\n')}\n\n## Established canon\n${draft.canon.join('\n')}\n\n## Tentative ideas\n${draft.tentative.join('\n')}\n\n## Characters\n${draft.characters.join('\n')}\n\n## Chronology\n${draft.chronology.join('\n')}\n\n## Source revision notes\n${draft.sourceIds.join('\n')}\n\n## Scene objectives\n${draft.scenes.map(scene => `### ${scene.title}\n${scene.objective}`).join('\n\n')}`
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'writing-brief.md'
    anchor.click()
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 1000)
  }
  return (
    <section className={css.surface} aria-label={props.t('writing.workspace')}>
      <div className={css.toolbar}>
        <button
          type="button"
          aria-expanded={structure}
          onClick={() => {
            setStructure(!structure)
          }}
        >
          {props.t('writing.structure')}
        </button>
        <button type="button" onClick={exportBrief}>
          {props.t('writing.export')}
        </button>
      </div>
      {structure && (
        <div className={css.writingBrief}>
          {error !== undefined && <p role="alert">{error}</p>}
          <label>
            {props.t('writing.specialization')}
            <select
              aria-label={props.t('writing.specialization')}
              value={draft.specialization}
              onChange={(event) => {
                setDraft({ ...draft, specialization: event.target.value as Writing['specialization'] })
              }}
            >
              {(['general', 'novel', 'drama', 'game', 'recap'] as const).map(value => (
                <option key={value} value={value}>
                  {props.t(`writing.${value}`)}
                </option>
              ))}
            </select>
          </label>
          {(['brief', 'style'] as const).map(field => (
            <label key={field}>
              {props.t(`writing.${field}`)}
              <textarea
                aria-label={props.t(`writing.${field}`)}
                value={draft[field]}
                onChange={(event) => {
                  setDraft({ ...draft, [field]: event.target.value })
                }}
              />
            </label>
          ))}
          {(
            ['outline', ...(draft.specialization === 'general' ? [] : ['canon', 'tentative', 'characters', 'chronology'])] as (
              | 'outline'
              | 'canon'
              | 'tentative'
              | 'characters'
              | 'chronology'
            )[]
          ).map(field => (
            <label key={field}>
              {props.t(`writing.${field}`)}
              <textarea
                aria-label={props.t(`writing.${field}`)}
                value={draft[field].join('\n')}
                onChange={(event) => {
                  setDraft({ ...draft, [field]: event.target.value.split('\n') })
                }}
              />
            </label>
          ))}
          {draft.specialization !== 'general' && (
            <label>
              {props.t('writing.scenes')}
              <textarea
                aria-label={props.t('writing.scenes')}
                value={draft.scenes.map(value => `${value.title}: ${value.objective}`).join('\n')}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    scenes: event.target.value.split('\n').map((value) => {
                      const index = value.indexOf(':')
                      return {
                        title: index < 0 ? value : value.slice(0, index),
                        objective: index < 0 ? '' : value.slice(index + 1).trim(),
                      }
                    }),
                  })
                }}
              />
            </label>
          )}
          <label>
            {props.t('writing.sourceNotes')}
            <textarea
              value={sourcePaths}
              onChange={(event) => {
                setSourcePaths(event.target.value)
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy || props.project === undefined || sourcePaths.trim() === ''}
            onClick={() => {
              const project = props.project
              const epoch = generation.current
              if (project === undefined) return
              setBusy(true)
              void Promise.all(
                sourcePaths
                  .split('\n')
                  .map(path => path.trim())
                  .filter(Boolean)
                  .map(path => props.registerArtifact({ projectId: project.workspaceId, path, kind: 'source' })),
              )
                .then(
                  (sources) => {
                    if (generation.current === epoch)
                      setDraft(value => ({
                        ...value,
                        sourceIds: [...new Set([...value.sourceIds, ...sources.map(source => source.id)])],
                      }))
                  },
                  (reason: unknown) => {
                    if (generation.current === epoch) setError(String(reason))
                  },
                )
                .finally(() => {
                  if (generation.current === epoch) setBusy(false)
                })
            }}
          >
            {props.t('writing.captureNotes')}
          </button>
          <p>{draft.sourceIds.join(', ')}</p>
          <label>
            {props.t('writing.consultation')}
            <select
              value={consultation}
              onChange={(event) => {
                setConsultation(event.target.value)
              }}
            >
              {(['continuity', 'structure', 'style'] as const).map(value => (
                <option key={value} value={value}>
                  {props.t(`writing.consult.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={props.sessionId === null || props.requestSelectionEdit === undefined}
            onClick={() => {
              if (props.sessionId !== null)
                void props
                  .requestSelectionEdit?.(
                    props.sessionId,
                    'writing-project',
                    JSON.stringify(draft),
                    `Give a scoped ${consultation} consultation. Return suggestions for the primary writer to review. Preserve established canon, label tentative ideas, and do not edit project files or launch other autonomous agents.`,
                  )
                  .catch((reason: unknown) => {
                    setError(String(reason))
                  })
            }}
          >
            {props.t('writing.requestConsultation')}
          </button>
          <button type="button" disabled={busy || props.project === undefined} onClick={save}>
            {props.t('writing.saveBrief')}
          </button>
        </div>
      )}
      <DocumentPanel {...props} hideFiles profile="writing" />
    </section>
  )
}

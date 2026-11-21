import type { ReactElement } from 'react'

import {
  formatModelCapacity,
  MODEL_CONTEXT_CAP,
  modelFigureLine,
  modelFactsFor,
  type ModelFacts,
  type ModelFactsKey,
  type ModelFactsTranslate,
  type ModelProbeReading,
} from './model-facts.ts'

/**
 * The one row of per-model facts, shared by all three pages.
 *
 * ## Why one component
 *
 * A model can be seen in three places — the sign-in page, the aggregate lane
 * and the account pool — and these used to be three independent renderings of
 * the same underlying numbers. That is not a duplication problem, it is a
 * truthfulness problem: when the pool lane reported a live 128K window and the
 * aggregate lane printed the registry's absent value, the same model looked
 * like two different models, and the user had no way to tell which was right.
 * Sharing the component means a fact is read in one place, so the three pages
 * cannot disagree.
 *
 * ## What it prints, and what it refuses to print
 *
 * Only what an upstream published: context window, output ceiling, whether the
 * model takes images, and the thinking levels it names. A field nobody
 * published is omitted entirely rather than filled with a plausible guess —
 * see {@link modelFactsFor} for why that rule exists. The one inference, a
 * window above the pool's own {@link MODEL_CONTEXT_CAP}, is labelled as capped
 * because that cap is a number this plugin chose and can therefore prove.
 *
 * The row renders nothing at all when nothing is known, which is the honest
 * outcome for the majority of registry rows: 456 of 504 carry no window, and
 * none carries vision or reasoning data.
 */

/** Props for {@link ModelFactsRow}. */
export interface ModelFactsRowProps {
  /**
   * The row to describe, in whatever spelling the calling page has.
   *
   * Typed loosely on purpose: all three pages read rows that arrived over the
   * wire, and {@link modelFactsFor} is what decides what is usable.
   *
   * May be omitted when `facts` is passed instead. The two are alternatives —
   * "here is the raw row, work it out" and "here is the answer" — and the
   * aggregate page is the one that has already done the work by the time it
   * renders, so requiring it there would mean handing the same numbers over
   * twice.
   */
  readonly row?: {
    contextWindow?: unknown
    maxOutputTokens?: unknown
    supportsImages?: unknown
    vision?: unknown
    supportedEfforts?: unknown
    description?: unknown
    notes?: unknown
  }
  /**
   * Pre-resolved facts, when the caller already computed them.
   *
   * Taking precedence over `row` rather than merging with it: a merge would
   * make it possible for the two to disagree, and a row showing two different
   * windows is the exact failure this component exists to prevent.
   */
  readonly facts?: ModelFacts | undefined
  /**
   * Settings translator, when the calling page has one.
   *
   * Typed over {@link ModelFactsKey}, the union of keys this component asks
   * for. Every page translator is typed over the plugin's whole key union,
   * which is wider, so each page hands its own translator straight in with no
   * cast. A key that did not exist would fall back to the English literal
   * rather than render blank, so the fallback is a real safety net rather than
   * decoration.
   */
  readonly t?: ModelFactsTranslate | undefined
  /** Extra class on the wrapper, so a page can align it inside its own row. */
  readonly className?: string
  /**
   * Run the connectivity probe for this row.
   *
   * Omitted from pages that cannot probe. When absent the button is not
   * rendered at all rather than rendered disabled: a control that is always
   * greyed out reads as "this build cannot test connections", which is a
   * different and more alarming claim than "there is nothing to test here".
   */
  readonly onTest?: () => void
  /** Measurement from a completed probe, if one ran. */
  readonly probe?: ModelProbeReading | undefined
  /** True while a probe is in flight for this row. */
  readonly probing?: boolean
}

/** One labelled figure, omitted entirely when the value is unknown. */
function Figure({ label, value, title }: {
  label: string
  value: string
  title?: string
}): ReactElement {
  return (
    <span className="fact" {...(title === undefined ? {} : { title })}>
      <span className="td-name">{label}</span>
      <span className="td-num">{value}</span>
    </span>
  )
}

/**
 * Print one model's figures, or nothing when there are none.
 *
 * The whole-row-is-null case matters: a settings dialog full of rows reading
 * "context — · output — · images —" teaches the user that the dashes mean
 * "broken", when they actually mean "not published". An absent row is quieter
 * and truer.
 */
export function ModelFactsRow({ row, t, className, facts, onTest, probe, probing }: ModelFactsRowProps): ReactElement | null {
  // A caller that passed neither has nothing to describe. Returning null is the
  // honest outcome, not a crash: the row was empty, so the row prints nothing.
  const resolved = facts ?? (row === undefined ? undefined : modelFactsFor(row))
  if (resolved === undefined) return null
  const figures = modelFigureLine(resolved)
  const say = (key: ModelFactsKey, fallback: string, params?: Record<string, unknown>): string => {
    // A page may hand us a translator typed for its own key union, so the cast
    // is here rather than at every call site. The keys are all ours.
    const translated = t?.(key, params)
    return translated === undefined || translated === '' ? fallback : translated
  }
  const hasFigures = figures.context !== undefined
    || figures.output !== undefined
    || figures.vision !== undefined
    || figures.efforts !== undefined
  // A row with no published facts still gets its test button, so the truthy
  // case is "there is something to say OR something to test" — not just "there is
  // something to say". A model that publishes no window is exactly the model a
  // user is most likely to want to check.
  if (!hasFigures && resolved.description === undefined && onTest === undefined && probe === undefined) {
    return null
  }
  return (
    <div className={`dsm-xdpool-mfacts${className === undefined ? '' : ` ${className}`}`}>
      {resolved.description === undefined ? null
        : <p className="hint">{resolved.description}</p>}
      {hasFigures || onTest !== undefined || probe !== undefined
        ? <div className="fact">
            {figures.context === undefined ? null
              : <Figure
                  label={say('facts.context', 'context')}
                  value={figures.context}
                  {...(figures.capped && resolved.contextWindow !== undefined
                    ? {
                        title: say('facts.capped', 'capped by this pool', {
                          served: figures.context ?? '',
                          published: formatModelCapacity(resolved.contextWindow),
                        }),
                      }
                    : {})}
                />}
            {figures.output === undefined ? null
              : <Figure label={say('facts.output', 'out')} value={figures.output} />}
            {figures.vision === undefined ? null
              : <Figure
                  label={say('facts.input', 'input')}
                  value={figures.vision === 'both'
                    ? say('facts.textAndImage', 'text+image')
                    : say('facts.textOnly', 'text only')}
                />}
            {figures.efforts === undefined ? null
              : <Figure
                  label={say('facts.thinking', 'thinking')}
                  value={figures.efforts}
                  title={say('facts.thinkingHint', 'thinking levels the model publishes')}
                />}
            {probe === undefined ? null
              : <span
                  className="hint"
                  data-ok={probe.ok ? 'true' : 'false'}
                  title={probe.error ?? undefined}
                >
                  {probe.firstFrameMs === undefined ? null
                    : <span>
                        {say('facts.firstFrame', 'first token')}{' '}
                        <b>{probe.firstFrameMs}ms</b>
                      </span>}
                  <span>
                    {say('facts.outputChars', 'output')}{' '}
                    <b>{probe.outputChars}</b>
                  </span>
                  <span>{probe.ok
                    ? say('facts.probeOk', 'answered')
                    : say('facts.probeFailed', 'no answer')}</span>
                </span>}
            {probe !== undefined || onTest === undefined ? null
              : <button
                  type="button"
                  className="tiny"
                  onClick={() => { onTest() }}
                  disabled={probing === true}
                  aria-busy={probing === true}
                  title={say('facts.testHint', 'Sends one short real request and reports what came back')}
                >
                  {probing === true
                    ? say('facts.testing', 'Testing…')
                    : say('facts.test', 'Test connection')}
                </button>}
          </div>
        : null}
      {probe?.error === undefined ? null
        : <span className="hint">{probe.error}</span>}
    </div>
  )
}
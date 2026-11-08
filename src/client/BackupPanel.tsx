/**
 * Export and import the whole credential set, as one password-protected file.
 *
 * WHAT MOVES
 *
 * Every channel account's credential value, the model blacklist, the permanent-lock
 * table, and — through the pool half — the WorkBuddy accounts with their selection and
 * routing settings. The point is moving to a new machine without re-scanning a dozen QR
 * codes.
 *
 * WHY ENCRYPTION IS NOT OPTIONAL
 *
 * The payload contains credential values, which are enough to sign in as those accounts. A
 * plain file in a downloads folder or a chat window is a leak with extra steps, so the
 * export refuses to run without a password.
 *
 * ONE ACTION AT A TIME
 *
 * The first version put a raw `<input type="file">` on screen beside two buttons, which
 * rendered as three separate "choose file" controls — the browser's own picker, plus the
 * buttons meant to hide it. The input's `display:none` rule lived in a stylesheet that
 * this page never loads, so the native control was never hidden.
 *
 * This version carries its OWN stylesheet and hides the input structurally: there is one
 * button per action, and the file is chosen as part of the import, not before it. Picking
 * a file and then pressing "import" was two steps for one intention.
 *
 * @module dsh-xdpool/client/BackupPanel
 */
import { useCallback, useRef, useState, type ReactElement } from 'react'
import { callPack } from './channel-rpc.ts'
import { decryptBackup, encryptBackup, isEncryptedEnvelope, MIN_PASSWORD } from './backup-crypto.ts'
import { BACKUP_CSS } from './styles.ts'
import type { XdPoolSettingsKey } from './locales.ts'

type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

/** What `backup.status` answers: enough to warn before an overwrite. */
interface BackupStatus {
  accounts: number
  withoutExpiry: number
}

function statusFrom(value: unknown): BackupStatus | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const accounts = record['accounts']
  if (typeof accounts !== 'number') return undefined
  return {
    accounts,
    withoutExpiry: typeof record['withoutExpiry'] === 'number' ? record['withoutExpiry'] as number : 0,
  }
}

export function BackupPanel({ t }: { readonly t?: Translate | undefined }): ReactElement {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  /**
   * The chosen file, held in state rather than only in a ref.
   *
   * The old version read `input.files[0]` at import time, which meant the user had to
   * pick a file BEFORE knowing whether the password was even long enough — and the button
   * that did the picking sat beside the one that used it. Holding the name lets the row
   * say what is selected and lets one button do the whole job.
   */
  const [picked, setPicked] = useState<{ name: string; text: Promise<string> } | undefined>(undefined)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const reset = (): void => { setNotice(undefined); setError(undefined) }
  const tooShort = password.length < MIN_PASSWORD

  /**
   * Export: ask the pack for the payload, encrypt it here, hand the user a file.
   *
   * The RPC answer is never written to disk in plaintext — it lives in this closure and in
   * memory for the length of one encrypt.
   */
  const exportBackup = useCallback(async (): Promise<void> => {
    reset()
    if (tooShort) {
      setError(t?.('backup.passwordShort', { min: MIN_PASSWORD }) ?? `Password must be at least ${String(MIN_PASSWORD)} characters.`)
      return
    }
    setBusy(true)
    try {
      const answer = await callPack('backup.export', {})
      if (answer.ok === false) {
        setError(answer.error?.message ?? (t?.('backup.exportFailed') ?? 'Export failed.'))
        return
      }
      const value = answer.value as { payload?: unknown; warnings?: unknown } | undefined
      if (value?.payload === undefined) {
        setError(t?.('backup.exportEmpty') ?? 'The pack returned no payload.')
        return
      }
      const envelope = await encryptBackup(JSON.stringify(value.payload), password)
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      // A dated name so two exports do not overwrite each other in Downloads.
      anchor.download = `xdpool-accounts-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      const warnings = Array.isArray(value.warnings) ? value.warnings.length : 0
      setNotice(
        warnings > 0
          ? (t?.('backup.exportedWarn', { count: warnings }) ?? `Exported, with ${String(warnings)} warning(s).`)
          : (t?.('backup.exported') ?? 'Exported. Keep the password — the file cannot be opened without it.'),
      )
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [password, tooShort, t])

  /** Remember the file the user chose, and clear the input so the same one can be re-picked. */
  const chooseFile = useCallback((): void => {
    const input = fileRef.current
    if (input === null) return
    input.click()
  }, [])

  const onFileChosen = useCallback((): void => {
    reset()
    const file = fileRef.current?.files?.[0]
    if (file === undefined) { setPicked(undefined); return }
    // `text()` starts reading immediately; awaiting it here would block the UI on a file
    // the user may then cancel.
    setPicked({ name: file.name, text: file.text() })
    // A file input keeps its value, so re-picking the same file fires no change event —
    // which looks like a dead button after a failed password.
    if (fileRef.current !== null) fileRef.current.value = ''
  }, [])

  /**
   * Import: decrypt in the browser, then hand the pack a plaintext payload.
   *
   * `backup.import` REPLACES the account set, so the overwrite count is read first and
   * shown in the confirm dialog.
   */
  const importBackup = useCallback(async (): Promise<void> => {
    reset()
    if (picked === undefined) {
      // No file yet: the button's job here is to start the choice, not to scold.
      chooseFile()
      return
    }
    setBusy(true)
    try {
      let text: string
      try {
        text = await picked.text
      } catch {
        setError(t?.('backup.fileUnreadable') ?? 'The file could not be read.')
        setPicked(undefined)
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        setError(t?.('backup.notJson') ?? 'That file is not a backup.')
        setPicked(undefined)
        return
      }
      let payload: unknown
      if (isEncryptedEnvelope(parsed)) {
        if (tooShort) {
          setError(t?.('backup.passwordShort', { min: MIN_PASSWORD }) ?? `Password must be at least ${String(MIN_PASSWORD)} characters.`)
          return
        }
        try {
          payload = JSON.parse(await decryptBackup(parsed, password))
        } catch {
          // Wrong password and a corrupt file are deliberately one message.
          setError(t?.('backup.badPassword') ?? 'Wrong password, or the file is damaged.')
          return
        }
      } else {
        // A plain payload is accepted so an older unencrypted export still restores.
        payload = parsed
      }

      const before = statusFrom((await callPack('backup.status', {})).value)
      const replacing = before?.accounts ?? 0
      const message = (t?.('backup.confirm', { count: replacing }) ?? `This REPLACES all ${String(replacing)} account(s). Continue?`)
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(message)) {
        return
      }

      const answer = await callPack('backup.import', { payload })
      if (answer.ok === false) {
        setError(answer.error?.message ?? (t?.('backup.importFailed') ?? 'Import failed.'))
        return
      }
      const result = answer.value as {
        credentialsImported?: unknown
        accountsImported?: unknown
        skipped?: unknown
      } | undefined
      const accounts = typeof result?.accountsImported === 'number' ? result.accountsImported : 0
      const credentials = typeof result?.credentialsImported === 'number' ? result.credentialsImported : 0
      const skipped = Array.isArray(result?.skipped) ? result.skipped.length : 0
      setNotice(
        skipped > 0
          ? (t?.('backup.importedPartial', { accounts, credentials, skipped })
            ?? `Imported ${String(accounts)} account(s), ${String(skipped)} skipped.`)
          : (t?.('backup.imported', { accounts, credentials })
            ?? `Imported ${String(accounts)} account(s) with ${String(credentials)} credential(s).`),
      )
      // The file has been consumed; keeping its name on screen invites a second import of
      // the same backup.
      setPicked(undefined)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [chooseFile, password, picked, tooShort, t])

  return (
    <div className="dsm-xdpool-bak">
      {/* Own stylesheet. The `display:none` that hid the raw file input used to live in a
          page block this component never loads, so the browser's own picker rendered
          beside the buttons — three "choose file" controls for one action. */}
      <style>{BACKUP_CSS}</style>
      <div className="dsm-xdpool-bak-head">
        <span className="dsm-xdpool-bak-title">{t?.('backup.title') ?? '账号备份'}</span>
        <span className="dsm-xdpool-bak-warn">{t?.('backup.encrypted') ?? '加密'}</span>
      </div>
      <p className="dsm-xdpool-bak-hint">{t?.('backup.hint') ?? ''}</p>

      <label className="dsm-xdpool-bak-field">
        <span className="dsm-xdpool-bak-label">{t?.('backup.password') ?? '密码'}</span>
        <input
          type="password"
          className="dsm-xdpool-bak-input"
          value={password}
          disabled={busy}
          autoComplete="new-password"
          placeholder={t?.('backup.passwordPlaceholder', { min: MIN_PASSWORD }) ?? `至少 ${String(MIN_PASSWORD)} 位`}
          onChange={event => { setPassword(event.target.value) }}
        />
      </label>

      {/* Two actions, one button each. The import button doubles as the file picker until
          a file exists, so the row never shows a control whose only job is to reveal
          another one. */}
      <div className="dsm-xdpool-bak-actions">
        <button
          type="button"
          className="dsm-xdpool-bak-btn"
          data-tone="primary"
          disabled={busy || tooShort}
          title={tooShort
            ? (t?.('backup.passwordShort', { min: MIN_PASSWORD }) ?? '')
            : (t?.('backup.exportHint') ?? '导出为加密文件')}
          onClick={() => { void exportBackup() }}
        >
          {t?.('backup.export') ?? '导出'}
        </button>
        <button
          type="button"
          className="dsm-xdpool-bak-btn"
          data-tone="quiet"
          disabled={busy}
          title={picked === undefined
            ? (t?.('backup.pickHint') ?? '选择要导入的备份文件')
            : (t?.('backup.importHint') ?? '导入会整体替换现有账号')}
          onClick={() => { void importBackup() }}
        >
          {picked === undefined
            ? (t?.('backup.pick') ?? '选择文件并导入')
            : (t?.('backup.import') ?? '导入')}
        </button>
        {/* Structurally out of the layout, so no stylesheet is required to hide it. */}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={onFileChosen}
        />
      </div>

      {picked === undefined ? null : (
        <div className="dsm-xdpool-bak-file">
          <span className="dsm-xdpool-bak-filename" title={picked.name}>{picked.name}</span>
          <button
            type="button"
            className="dsm-xdpool-bak-clear"
            aria-label={t?.('backup.clearFile') ?? '取消选择'}
            disabled={busy}
            onClick={() => { setPicked(undefined) }}
          >
            ×
          </button>
        </div>
      )}

      {notice === undefined ? null : <p className="dsm-xdpool-bak-note">{notice}</p>}
      {error === undefined ? null : <p className="dsm-xdpool-bak-error">{error}</p>}
    </div>
  )
}

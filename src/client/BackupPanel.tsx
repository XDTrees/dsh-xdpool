/**
 * 备份页 —— 照设计稿 xdpool-design/backup.html 与 backup-done.html。
 *
 * 区块（与设计稿一一对应）
 *
 *   .mhead     备份 / 账号池、设置、路由规则 ·【导入】【立即备份】
 *   .banner    备份包含凭据，请妥善保管
 *   section    立即备份：密码 + 再输入一次 →【生成备份文件】【取消】+ 提示
 *   section    历史备份：时间 / 大小 / 包含 / 操作（恢复、删除）
 *
 * 生成之后整页换成 backup-done.html：备份完成 · 已生成 ·【返回备份】，
 * banner「备份文件已生成」+【保存到…】【完成】+ 提醒。
 *
 * 导入（选文件）和从历史恢复走同一条路：先在「恢复备份」区块输入那份备份的密码，
 * 在浏览器里解密，读 `backup.status` 告诉用户会替换多少账号，确认后 `backup.import`。
 *
 * 加密：载荷里有每个账号的凭据，所以导出必须有密码；密文在这里生成，明文从不写盘。
 * 历史备份只存密文（见 backup-history.ts）。
 *
 * 检查更新不在这一页：左上角版本号旁的小圆圈负责（shell.tsx）。
 *
 * 结构：只有一个 <main className="main">，里面是 .mhead + .mbody；隐形的文件选择框也在
 * .mbody 里，免得多出一个元素把 .app 网格挤乱。
 *
 * @module dsh-xdpool/client/BackupPanel
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { callPack } from './channel-rpc.ts'
import { decryptBackup, encryptBackup, isEncryptedEnvelope, MIN_PASSWORD } from './backup-crypto.ts'
import {
  deleteBackup,
  historyAvailable,
  listBackups,
  readBackupText,
  saveBackup,
  type BackupEntry,
} from './backup-history.ts'
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

/** 后端或浏览器给的英文错误不直接给用户看：有中文就用，没有就用兜底的中文。 */
function zh(message: string | undefined, fallback: string): string {
  return message !== undefined && /[\u4e00-\u9fff]/u.test(message) ? message : fallback
}

/** 2.4MB / 512KB / 900B */
function sizeText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${String(Math.round(bytes))}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function pad(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n)
}

/** 今天 09:12 / 昨天 21:03 / 10 月 28 日 / 2025 年 10 月 28 日 */
function whenText(ms: number): string {
  const at = new Date(ms)
  if (Number.isNaN(at.getTime())) return '—'
  const now = new Date()
  const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day(now) - day(at)) / 86_400_000)
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (diff === 0) return `今天 ${clock}`
  if (diff === 1) return `昨天 ${clock}`
  const md = `${String(at.getMonth() + 1)} 月 ${String(at.getDate())} 日`
  return at.getFullYear() === now.getFullYear() ? md : `${String(at.getFullYear())} 年 ${md}`
}

/** 历史备份表格的列宽，照设计稿。 */
const COLS = { gridTemplateColumns: 'minmax(0,1fr) 88px 96px 130px' }

/** 生成完成后 backup-done.html 要显示的东西。 */
interface DoneState {
  blob: Blob
  fileName: string
  accounts: number
  size: number
  /** 是否已存进历史备份。 */
  kept: boolean
  warnings: number
}

export function BackupPanel({ t: _t }: { readonly t?: Translate | undefined }): ReactElement {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  /** 恢复用的密码，和生成备份的密码分开 —— 要恢复的那份可能是用别的密码加密的。 */
  const [restorePassword, setRestorePassword] = useState('')
  const passwordRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [done, setDone] = useState<DoneState | undefined>(undefined)
  const [history, setHistory] = useState<readonly BackupEntry[] | undefined>(undefined)
  const [historyBroken, setHistoryBroken] = useState(false)
  /**
   * 要恢复的那份：选的文件，或历史备份里的一行。
   * `text` 立即开始读，点「恢复」时才 await。
   */
  const [picked, setPicked] = useState<{ name: string; text: Promise<string> } | undefined>(undefined)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const reset = (): void => { setNotice(undefined); setError(undefined) }
  const tooShort = password.length < MIN_PASSWORD
  const mismatch = password !== confirm
  const restoreShort = restorePassword.length < MIN_PASSWORD

  const refresh = useCallback(async (): Promise<void> => {
    if (!historyAvailable()) { setHistoryBroken(true); setHistory([]); return }
    try {
      setHistory(await listBackups())
      setHistoryBroken(false)
    } catch {
      setHistoryBroken(true)
      setHistory([])
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  /**
   * 生成备份：向渠道包要载荷，在这里加密，存进历史备份，然后显示「备份完成」。
   * 文件本身由「保存到…」交给用户。
   */
  const exportBackup = useCallback(async (): Promise<void> => {
    reset()
    if (tooShort) {
      setError(`密码至少 ${String(MIN_PASSWORD)} 位。`)
      passwordRef.current?.focus()
      return
    }
    if (mismatch) { setError('两次输入的密码不一样。'); return }
    setBusy(true)
    try {
      const answer = await callPack('backup.export', {})
      if (answer.ok === false) { setError(zh(answer.error?.message, '导出失败，请稍后再试。')); return }
      const value = answer.value as { payload?: unknown; warnings?: unknown } | undefined
      if (value?.payload === undefined) { setError('渠道包没有返回内容。'); return }
      const envelope = await encryptBackup(JSON.stringify(value.payload), password)
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
      const accounts = statusFrom((await callPack('backup.status', {})).value)?.accounts ?? 0
      let kept = false
      try {
        await saveBackup(envelope, accounts, blob.size)
        kept = true
      } catch {
        kept = false
      }
      setDone({
        blob,
        // 带日期和时间，两次导出不会在下载目录里互相覆盖。
        fileName: `xdpool-backup-${new Date().toISOString().slice(0, 16).replace(/[T:]/gu, '-')}.json`,
        accounts,
        size: blob.size,
        kept,
        warnings: Array.isArray(value.warnings) ? value.warnings.length : 0,
      })
      setPassword('')
      setConfirm('')
      void refresh()
    } catch (cause: unknown) {
      setError(zh(cause instanceof Error ? cause.message : undefined, '生成备份失败。'))
    } finally {
      setBusy(false)
    }
  }, [password, tooShort, mismatch, refresh])

  /** 「保存到…」：把生成好的密文文件交给浏览器保存。 */
  const saveFile = useCallback((): void => {
    if (done === undefined) return
    const url = URL.createObjectURL(done.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = done.fileName
    anchor.click()
    setTimeout(() => { URL.revokeObjectURL(url) }, 10_000)
  }, [done])

  const chooseFile = useCallback((): void => {
    const input = fileRef.current
    if (input === null) return
    input.click()
  }, [])

  const onFileChosen = useCallback((): void => {
    reset()
    const file = fileRef.current?.files?.[0]
    if (file === undefined) return
    const text = file.text()
    text.catch(() => undefined)
    setPicked({ name: file.name, text })
    setRestorePassword('')
    // A file input keeps its value, so re-picking the same file fires no change event.
    if (fileRef.current !== null) fileRef.current.value = ''
    setTimeout(() => { restoreRef.current?.focus() }, 0)
  }, [])

  /** 历史备份的「恢复」：和选文件一样，进入「恢复备份」区块等密码。 */
  const pickHistory = useCallback((entry: BackupEntry): void => {
    reset()
    const text = readBackupText(entry.id)
    text.catch(() => undefined)
    setPicked({ name: `历史备份 · ${whenText(entry.createdAt)} · ${String(entry.accounts)} 账号`, text })
    setRestorePassword('')
    setTimeout(() => { restoreRef.current?.focus() }, 0)
  }, [])

  /**
   * 恢复：在浏览器里解密，再把明文载荷交给渠道包。
   * `backup.import` 会整体替换账号，所以先读 `backup.status`，在确认框里说清会替换多少个。
   */
  const importBackup = useCallback(async (): Promise<void> => {
    reset()
    if (picked === undefined) {
      // 还没选文件：这个按钮先负责选文件。
      chooseFile()
      return
    }
    setBusy(true)
    try {
      let text: string
      try {
        text = await picked.text
      } catch {
        setError('读不出这份备份。')
        setPicked(undefined)
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        setError('这个文件不是备份。')
        setPicked(undefined)
        return
      }
      let payload: unknown
      if (isEncryptedEnvelope(parsed)) {
        if (restoreShort) {
          setError(`请输入这份备份的密码（至少 ${String(MIN_PASSWORD)} 位）。`)
          restoreRef.current?.focus()
          return
        }
        try {
          payload = JSON.parse(await decryptBackup(parsed, restorePassword))
        } catch {
          // 密码错和文件坏是同一句话。
          setError('密码不对，或文件已损坏。')
          return
        }
      } else {
        // 没加密的旧导出也能恢复。
        payload = parsed
      }

      const before = statusFrom((await callPack('backup.status', {})).value)
      const replacing = before?.accounts ?? 0
      const message = `恢复会整体替换现有的 ${String(replacing)} 个账号，继续吗？`
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(message)) {
        return
      }

      const answer = await callPack('backup.import', { payload })
      if (answer.ok === false) { setError(zh(answer.error?.message, '恢复失败。')); return }
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
          ? `已恢复 ${String(accounts)} 个账号、${String(credentials)} 份凭据，${String(skipped)} 个被跳过。`
          : `已恢复 ${String(accounts)} 个账号、${String(credentials)} 份凭据。`,
      )
      // 用过的备份不再留在屏幕上，免得再点一次又恢复一遍。
      setPicked(undefined)
      setRestorePassword('')
    } catch (cause: unknown) {
      setError(zh(cause instanceof Error ? cause.message : undefined, '恢复失败。'))
    } finally {
      setBusy(false)
    }
  }, [chooseFile, picked, restorePassword, restoreShort])

  const removeHistory = useCallback(async (entry: BackupEntry): Promise<void> => {
    reset()
    const ask = `删除 ${whenText(entry.createdAt)} 的备份？删除后找不回来。`
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(ask)) return
    try {
      await deleteBackup(entry.id)
      setNotice('已删除这份备份。')
    } catch {
      setError('删除失败。')
    }
    await refresh()
  }, [refresh])

  // ── 备份完成（backup-done.html）──
  if (done !== undefined) {
    return (
      <main className="main">
        <header className="mhead">
          <div className="mhead-title">
            <span className="mhead-name">备份完成</span>
            <span className="pill" data-tone="ok">已生成</span>
          </div>
          <div className="mhead-actions">
            <button type="button" className="btn" onClick={() => { setDone(undefined) }}>返回备份</button>
          </div>
        </header>
        <div className="mbody">
          <div className="banner">
            <span className="banner-icon" aria-hidden="true" style={{ background: 'var(--accent-dim)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 12l5 5L20 6" /></svg>
            </span>
            <span className="banner-body">
              <span className="banner-t">备份文件已生成</span>
              <span className="banner-d">
                {`${String(done.accounts)} 个账号 · ${sizeText(done.size)} · 加密，需要密码才能恢复`}
              </span>
            </span>
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={saveFile}>保存到…</button>
            <button type="button" className="btn" onClick={() => { setDone(undefined) }}>完成</button>
          </div>
          <div className="hint">
            <b>提醒</b>
            <span>
              密码没有存进文件。丢了密码就解不开这份备份，请另外记下来。
              {done.kept ? '这份备份也已存进「历史备份」。' : '这台设备没能存进「历史备份」，请务必点「保存到…」另存一份。'}
              {done.warnings > 0 ? `导出时有 ${String(done.warnings)} 条警告，个别账号可能没带上。` : ''}
            </span>
          </div>
        </div>
      </main>
    )
  }

  // ── 备份（backup.html）──
  const rows = history ?? []
  return (
    <main className="main">
      <header className="mhead">
        <div className="mhead-title">
          <span className="mhead-name">备份</span>
          <span className="mhead-org">账号池、设置、路由规则</span>
        </div>
        <div className="mhead-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => { if (picked === undefined) { void importBackup() } else { chooseFile() } }}
          >
            导入
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              // 密码还没填好时把焦点送到密码框，而不是把按钮置灰让人猜差什么。
              if (tooShort || mismatch) { passwordRef.current?.focus(); return }
              void exportBackup()
            }}
          >
            立即备份
          </button>
        </div>
      </header>
      <div className="mbody">
        <div className="banner">
          <span className="banner-icon" aria-hidden="true" style={{ background: 'var(--surface-3)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3v12M8 11l4 4 4-4" /><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
          </span>
          <span className="banner-body">
            <span className="banner-t">备份包含凭据，请妥善保管</span>
            <span className="banner-d">导出的是加密文件，需要密码才能恢复。密码不会存进文件里，丢了就解不开。</span>
          </span>
        </div>

        {error === undefined ? null : (
          <div className="hint"><b>出错</b><span>{error}</span></div>
        )}
        {notice === undefined ? null : (
          <div className="hint"><b>完成</b><span>{notice}</span></div>
        )}

        {/* 选了文件、或点了历史备份的「恢复」之后才出现：输入那份备份的密码再恢复。 */}
        {picked === undefined ? null : (
          <section className="sec">
            <div className="sec-head"><span className="sec-title">恢复备份</span></div>
            <div className="card stack">
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <span className="mono" title={picked.name} style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {picked.name}
                </span>
                <button
                  type="button"
                  className="tiny"
                  aria-label="取消选择"
                  disabled={busy}
                  onClick={() => { setPicked(undefined); setRestorePassword('') }}
                >
                  ×
                </button>
              </div>
              <div className="field">
                <label htmlFor="xdp-backup-restore-pw">这份备份的密码</label>
                <input
                  id="xdp-backup-restore-pw"
                  ref={restoreRef}
                  className="input"
                  type="password"
                  value={restorePassword}
                  disabled={busy}
                  autoComplete="off"
                  placeholder={`至少 ${String(MIN_PASSWORD)} 位`}
                  onChange={event => { setRestorePassword(event.target.value) }}
                  onKeyDown={event => { if (event.key === 'Enter') void importBackup() }}
                />
              </div>
              <div className="row">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { void importBackup() }}>
                  {busy ? '恢复中…' : '恢复'}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => { setPicked(undefined); setRestorePassword('') }}>
                  取消
                </button>
              </div>
              <div className="hint"><b>注意</b><span>恢复会整体替换现有账号，恢复前会再问你一次。</span></div>
            </div>
          </section>
        )}

        <section className="sec">
          <div className="sec-head"><span className="sec-title">立即备份</span></div>
          <div className="card stack">
            <div className="grid2">
              <div className="field">
                <label htmlFor="xdp-backup-pw">密码</label>
                <input
                  id="xdp-backup-pw"
                  ref={passwordRef}
                  className="input"
                  type="password"
                  value={password}
                  disabled={busy}
                  autoComplete="new-password"
                  placeholder={`至少 ${String(MIN_PASSWORD)} 位`}
                  onChange={event => { setPassword(event.target.value) }}
                />
              </div>
              <div className="field">
                <label htmlFor="xdp-backup-pw2">再输入一次</label>
                <input
                  id="xdp-backup-pw2"
                  className="input"
                  type="password"
                  value={confirm}
                  disabled={busy}
                  autoComplete="new-password"
                  onChange={event => { setConfirm(event.target.value) }}
                  onKeyDown={event => { if (event.key === 'Enter') void exportBackup() }}
                />
              </div>
            </div>
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { void exportBackup() }}>
                {busy ? '生成中…' : '生成备份文件'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || (password === '' && confirm === '')}
                onClick={() => { setPassword(''); setConfirm(''); reset() }}
              >
                取消
              </button>
            </div>
            <div className="hint">
              <b>提示</b>
              <span>{`密码至少 ${String(MIN_PASSWORD)} 位。恢复时用同一个密码，忘记无法找回。`}</span>
            </div>
          </div>
        </section>

        <section className="sec">
          <div className="sec-head">
            <span className="sec-title">历史备份</span>
            <span className="sec-n num">{rows.length}</span>
          </div>
          <div className="table">
            <div className="tr tr-head" style={COLS}>
              <span className="td">时间</span>
              <span className="td td-num">大小</span>
              <span className="td td-num">包含</span>
              <span className="td td-num">操作</span>
            </div>
            {rows.length === 0 ? (
              <div className="tr" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
                <span className="td td-dim" style={{ textAlign: 'left' }}>
                  {history === undefined
                    ? '读取中…'
                    : historyBroken
                      ? '这台设备存不了历史备份，请用「保存到…」把备份文件另存一份。'
                      : '还没有备份。生成一次之后会出现在这里。'}
                </span>
              </div>
            ) : rows.map(entry => (
              <div key={entry.id} className="tr" style={COLS}>
                <span className="td">{whenText(entry.createdAt)}</span>
                <span className="td td-num">{sizeText(entry.size)}</span>
                <span className="td td-num">{`${String(entry.accounts)} 账号`}</span>
                <span className="td td-num row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                  <button type="button" className="tiny" disabled={busy} onClick={() => { pickHistory(entry) }}>恢复</button>
                  <button type="button" className="tiny" disabled={busy} onClick={() => { void removeHistory(entry) }}>删除</button>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* 选文件用；hidden 写在标记里，不靠样式表隐藏。 */}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={onFileChosen}
        />
      </div>
    </main>
  )
}

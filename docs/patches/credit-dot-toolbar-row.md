# 修复：积分圆点挂错行（`composer.dock` → `input.right`）

## 现象

输入框旁边那颗积分小圆点，在**克劳德风格主题（dsh-claude-style）**下位置不对：它不跟模型名/
思考等级/统计那一排走，而是留在卡片下面那条空行上（或随宿主重排而漂移）。两种主题各有一套
工具行布局，圆点只有一套落位，于是其中一种必然错。

## 根因

`src/client/index.tsx` 把圆点注册进 `conversation.composer.dock`，注释里写的是「在 InputBar 里，
和返回按钮、模型名、思考等级同一行」。但宿主（`dsh-client-ui-conversation` 的 `InputBar.tsx`）
里这两格不是一回事：

```tsx
<div className={row}>                     // 工具行：+ / 模式 / 模型 / 发送
  <div className={standardControls} hidden={activity}>
    {renderSlot('conversation.input.right', {})}   // ← 模型名之前
    {renderSlot('conversation.input.model', {})}
  </div>
  ...
</div>
...
<div className={dock} data-composer-dock>     // 卡片下面的**独立一行**
  {renderSlot('conversation.composer.dock', {})}
  <ContextMeter />
</div>
```

`.dock` 在卡片**下面**，不是工具行。dsh-claude-style 把工具行收进卡片后，dock 留空/被重排，
圆点就孤零零留在那条空线上——就是用户看到的「飘到别处」。

## 改法

1. 注册槽位改成 `conversation.input.right`（同一个包声明的 `kind: 'list'` 槽，模型选择器之前）。
   克劳德风格也明确给这个槽的第三方控件留了样式位（`[data-dsh-claude-part~="composer-controls"]`
   的 column-gap 归零、前置换号间距）。
2. 槽位注册失败时自动退回原来的 `conversation.composer.dock`，旧宿主不会因此丢圆点。
3. `credit-dot-css.ts` 补两条：工具行里 20px 对齐、克劳德风格下右侧留 6px 呼吸（本次提交已包含）。

## index.tsx 的改法（补丁）

本 PR 只直接提交了 CSS；`index.tsx` 的改动以补丁形式附在下面，因为它依赖宿主的 slot 声明，
我没有在你们的构建链（tsc + tsdown）里跑过类型检查，不想把一个未验证的 21KB 文件覆盖进去。

合并时把这条补丁应用到 `HEAD`（`81cb4e0`）即可。

```diff
diff --git a/src/client/index.tsx b/src/client/index.tsx
index 62b339a..ca29800 100644
--- a/src/client/index.tsx
+++ b/src/client/index.tsx
@@ -233,26 +233,50 @@ export function apply(ctx: WorkBuddyClientContext): void {
       console.error('[dsh-xdpool] sidebar entry unavailable (settings page unaffected):', error)
     }
     /**
-     * The credit dot beside the model name, in the composer's own row.
+     * The credit dot beside the model name, on the composer's toolbar row.
      *
-     * `conversation.composer.dock` is inside `InputBar`, on the line that already holds
-     * the back button, the model name and the reasoning level. That adjacency is the
-     * point: the dot is a statement about the model it sits next to, so putting it
-     * anywhere else would leave the reader to work out which channel it describes.
+     * The row it belongs to is `conversation.input.right` — the tool row that holds the model
+     * name and the reasoning level (`InputBar` renders it inside `.standardControls`, just
+     * before the model slot). The dot is a statement about the model it sits next to, so it
+     * has to live on that line.
      *
-     * It renders on the `composer` variant only (the host gates it), and does not appear
-     * on the hero screen where no session exists yet.
+     * It used to register into `conversation.composer.dock`. That slot is NOT the same line:
+     * `InputBar` renders the dock as a separate row BELOW the card, and hosts that restyle the
+     * composer move or empty that row — the Claude-style theme pulls the tool row into the card
+     * and leaves the dock blank, which strands the dot on an empty line, visually detached from
+     * the model it describes. `conversation.input.right` is a `list` slot declared by the same
+     * package (`dsh-client-ui-conversation`), so it is the supported placement for a control
+     * that belongs beside the model.
      *
-     * Own try/catch: a host line without this slot must not take the settings page down
-     * with it.
+     * It renders on the `composer` variant only (the host gates it), and does not appear on
+     * the hero screen where no session exists yet.
+     *
+     * Both registrations stay behind one try/catch, and the dock remains the fallback for a
+     * host line that does not declare `conversation.input.right`: a rejected slot must not
+     * take the settings page down with it.
      */
     try {
-      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
-        name: 'conversation.composer.dock',
+      const dotEntry = (slotName: string): {
+        name: string
+        id: string
+        order: number
+        inject: () => { t?: PoolCardInjected['t'] }
+      } => ({
+        name: slotName,
         id: 'xdpool-credit-dot',
         order: 20,
         inject: (): { t?: PoolCardInjected['t'] } => (t === undefined ? {} : { t }),
-      }, CreditDot))
+      })
+      const registerDot = (slotName: string) => (): (() => void) | undefined => {
+        try {
+          return ctx.slots.register(dotEntry(slotName), CreditDot)
+        } catch (error: unknown) {
+          console.error(`[dsh-xdpool] the credit dot could not use the ${slotName} slot:`, error)
+          if (slotName === 'conversation.composer.dock') return undefined
+          return ctx.slots.register(dotEntry('conversation.composer.dock'), CreditDot)
+        }
+      }
+      ctx.slots.inject('conversation.input.right', registerDot('conversation.input.right'))
     } catch (error: unknown) {
       console.error('[dsh-xdpool] composer credit dot unavailable (everything else unaffected):', error)
     }
```

## 验证

- 在**已发布的 3.0.7 产物**（`lib/client.js`）上做过对应修改，并用桩页面（`window.__ModuleLoader__`
  + 最小 `document`）执行了 `apply()`：`slots.inject` 收到的键是
  `settings.section` / `sidebar.panellist` / `main` / `conversation.input.right`，
  注册表里 `xdpool-credit-dot` 落在 `conversation.input.right`。
- 冒烟脚本只验证「注册到了哪个槽 + 样式是否注入」，**没有跑你们的 tsc/tsdown**，所以 `index.tsx`
  的补丁请以类型检查为准。

## 顺带发现（不在本 PR 范围内）

1. **积分明细的「剩余 / 总量」把绝对值当百分比乘了**：Qoder 资源包 `1748 / 1900` 显示成
   `33212 / 1900`（`1900 × 1748 / 100`）。如果协议层已经把 `remaining` 统一成 0-100 的百分比，
   那是 qoder/codearts 的 builder 漏了换算；如果仍混着绝对值，则渲染端要按 `unit` 区分。
2. **积分明细行数太多**：buddy 单账号 22-75 个批次，卡片里一屏放不下。建议过滤 `remaining = 0`
   的已用完批次 + 盒子限高内部滚动 + 日期缩成 `MM-DD`。
3. **Qoder/CodeArts 的逐笔到期只认官网会话 cookie**（`/api/v2/me/usages/big_model_credits`；
   同一套 OAuth token 打过去 401）。宿主已有 CDP 浏览器登录件（豆包/百智云在用），
   可以复用它开窗口读 cookie，再抓这个接口——这属于新功能，没放进本 PR。

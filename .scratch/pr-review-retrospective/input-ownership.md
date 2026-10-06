# Input ownership

Priority: medium. Classification: judgment rule and real-input coverage.

Suggested home: Ownership, asynchronous work, and errors in [CODE_CONVENTIONS.md](../../CODE_CONVENTIONS.md).

## Handle one input once and preserve usable focus

Proposed addition:

> Consume input only when the active operation handles it. Nested controls must perform one action per handled gesture or shortcut. Control updates should retain usable keyboard focus, with an enabled fallback when the focused control disappears or becomes disabled.

[PR #7's shortcut finding](https://github.com/the-Drunken-coder/Ridgeline/pull/7#discussion_r4110139345) showed nested drawing controls and their viewport both handling Undo. The [author's reproduction](https://github.com/the-Drunken-coder/Ridgeline/pull/7#discussion_r4110156317) found one Ctrl+Z removing two vertices. A separate [focus finding](https://github.com/the-Drunken-coder/Ridgeline/pull/7#discussion_r4087672427) showed rail and inspector reconstruction losing keyboard focus; the [response](https://github.com/the-Drunken-coder/Ridgeline/pull/7#discussion_r4110129936) reports stable focus keys and fallback behavior.

[PR #1's Escape finding](https://github.com/the-Drunken-coder/Ridgeline/pull/1#discussion_r4080214513) illustrates the opposite propagation mistake: an attachment consumed Escape even when it had no open overlay. These findings support conditional ownership, not a universal `stopPropagation()` rule.

## End interrupted gestures without discarding completed work

Proposed addition:

> Release transient gesture ownership when focus or pointer capture is lost. Preserve completed previews and accepted data. After interruption, ordinary state updates and the next valid gesture must remain usable.

[PR #6's blur finding](https://github.com/the-Drunken-coder/Ridgeline/pull/6#discussion_r4086806024) showed focus loss discarding completed previews. The [response](https://github.com/the-Drunken-coder/Ridgeline/pull/6#discussion_r4110108658) reports cancelling only active gestures and checking real pointer input.

[PR #31's pointer finding](https://github.com/the-Drunken-coder/Ridgeline/pull/31#discussion_r4127675571) showed an inspector stuck after release outside the document. The [response](https://github.com/the-Drunken-coder/Ridgeline/pull/31#discussion_r4127706037) reports real focus-loss and pointer-capture regressions that restore updates.

Existing rules require listener disposal and real browser input. This proposal adds the missing interruption and nested-input semantics. Verify one action per keypress, continued keyboard focus, focus/capture loss during a gesture, and an ordinary update after interruption. Keep this coverage scoped to the interaction being changed.

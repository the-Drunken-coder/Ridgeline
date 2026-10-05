# Interaction standards

Read when changing pointer or keyboard input, gestures, focus, hover, or interaction ownership. Use the common standards in [CODE_CONVENTIONS.md](../../CODE_CONVENTIONS.md), [lifecycle](lifecycle.md) for owners, and [testing](testing.md) for real-input evidence.

## Input propagation and focus

- Consume input only when the active operation handles it. Nested controls must perform one action per handled gesture or shortcut.
- Control updates should retain usable keyboard focus, with an enabled fallback when the focused control disappears or becomes disabled.
- Preserve ordinary consumer input when an attachment has no active operation to handle it. Propagation behavior follows ownership of the action, rather than one universal event-stopping rule.

When relevant, verify nested controls with one physical keypress and assert one observable action. Verify that keyboard operation continues after a control update, including a disabled or removed focused control.

## Interrupted and invalidated gestures

- Release transient gesture ownership when focus or pointer capture is lost. Preserve completed previews and accepted data. Ordinary state updates and the next valid gesture must remain usable after interruption.
- Invalidate screen-derived targets when relevant camera movement begins or scene data changes. Before applying input resolved across a callback, verify that the resolution still belongs to the current scene and operation, including after a successful callback return.
- Stationary input must respond to relevant scene changes. Verify recovery without requiring another pointer movement.

For changed gesture behavior, exercise the relevant native interruption or invalidation and observe the draft, accepted data, feedback, and subsequent usable input. Camera navigation variants must be exercised when their distinct behavior is part of the change; a translation gesture does not establish pitch behavior.

# Choose terrain-target feedback across camera angles

Type: prototype
Status: claimed
Assignee: current session
Blocked by: 01
Parent: [Terrain-aware pointer feedback](../map.md)

## Question

Which visual treatment makes the actual placement target clear without obscuring terrain or competing with the screen pointer? Present distinct static options covering top-down and shallow-angle placement, selectable hover, vertex snapping, navigation during a tool, and unavailable targets. The user chooses the direction before implementation.

Compare a simple screen-facing target with a treatment that also shows contact with terrain. Decide how presentation changes with camera angle, including contrast and marker size. Keep idle feedback still.

## Comments

2026-09-29: The user asked for a technical recommendation and concrete visual examples. Visual exploration can proceed using explicitly provisional interaction assumptions; target-precedence decisions need not block static appearance choices. Production implementation remains outside this ticket.

2026-09-29: [Static comparison prototype](../prototype/index.html) presents A, Screen reticle; B, Ground contact; and C, Raised locator. [Comparison image](../prototype/comparison.png), [snapping image](../prototype/snapping.png), and [unavailable-target image](../prototype/unavailable.png) are browser captures. The recommendation is B. Awaiting the user's visual choice; this ticket is not resolved.

See [design contract](../prototype/design-contract.md) for technical recommendation, provisional behavior, references, and limits. Browser checks covered all six review states, four variant views including comparison, keyboard switching, desktop and 390px layouts without horizontal overflow, and zero runtime exceptions. Those checks verify the mock, not real terrain picking. After the choice, preserve the prototype and verdict on a throwaway branch as the primary source.

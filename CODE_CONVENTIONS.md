# Code conventions

These are Ridgeline's implementation and review standards. Apply them to the work being changed; keep unrelated cleanup out of the patch. Compiler and build settings remain authoritative in their configuration files.

## Keep the final code lean

Review every addition critically before finishing. Remove code left over from experiments, debugging, and temporary test setup. Delete duplicate paths and speculative abstractions; keep production code and tests only when they support a real behavior, constraint, or failure mode. Work that helped during development does not need to remain in the product.

## Core qualities and priorities

- **Easy to use.** Make common mapping tasks straightforward through a clear public API, useful defaults, and practical examples. Keep integration and ongoing maintenance simple for consumers.
- **Feature-rich within a clear scope.** Provide complete, reusable mapping capabilities. Keep surrounding application workflows with consumers, as defined in [ADR-0001](docs/adr/0001-consumer-owned-workflows.md).
- **Dynamic.** Support changing geographic data, live updates, and interactive exploration without requiring consumers to rebuild the viewport or lose interaction state unnecessarily.
- **Customizable.** Let consumers adapt appearance and behavior through supported APIs. Common customization should not require a fork or knowledge of rendering internals.
- **High quality.** Treat correctness, reliable lifecycle behavior, accessible interactions, visual polish, and clear documentation as part of a finished capability.
- **Responsive and performant.** Keep interactions responsive as data and views change. Evaluate rendering cost, update latency, memory use, and idle work against representative consumer workloads.

Prioritize these qualities over being lightweight for its own sake. Bundle size, dependencies, and implementation complexity still have costs, but judge those costs against the capabilities and consumer experience they enable. When qualities compete, make the tradeoff explicit and use concrete consumer needs and measurements to guide the decision.

## Module and package boundaries

- Prefer deep modules that hide complex behavior behind a small interface. Test each module's behavior through that interface. This deliberately repeats the general engineering preference in the global `AGENTS.md` so repository implementers and reviewers have it here too.
- Keep the map library framework-neutral. Playground scenarios, sample data, and application workflows belong to consumers. Evaluate library additions against [ADR-0001](docs/adr/0001-consumer-owned-workflows.md).
- Keep public exports deliberate in `src/index.ts`. Expose a small interface that hides rendering and lifecycle machinery; exporting an internal helper solely to reach it from a test expands the wrong boundary.
- Keep the playground on the public library API. The separate control lab owns its framework dependencies and experiments.
- Use the explicit MapLibre integration allowed by [ADR-0002](docs/adr/0002-maplibre-extension-access.md). Add abstractions for concrete needs rather than hypothetical renderer replacement.

## TypeScript and data boundaries

- Preserve consumer property types through generic feature, event, and callback APIs. Infer local types and derive related types instead of maintaining parallel declarations.
- Use discriminated unions for distinct states and variants. Validate unknown external values before narrowing them; avoid `any`, unchecked assertions, and helpers whose only behavior is a cast.
- Follow the surrounding file's formatting. Keep formatting-only changes separate from behavioral work.
- Validate and snapshot consumer data at the owning boundary before mutating accepted state. Public reads must preserve the documented snapshot semantics rather than expose mutable internals.
- Use [CONTEXT.md](CONTEXT.md) terminology. Make coordinate order, units, altitude references, and missing-data behavior explicit at geographic boundaries. Unknown elevation must remain distinct from zero elevation.
- Preserve drawing shape metadata through storage and reload as required by [ADR-0003](docs/adr/0003-preserve-drawing-shape-definitions.md).

## Ownership, asynchronous work, and errors

- Give listeners, observers, scheduled work, interaction leases, and GPU resources a clear owner and disposal path. Teardown must tolerate partial initialization and repeated calls.
- Guard asynchronous completion against destruction, replacement, and newer state. A stale render or terrain result must not overwrite current data.
- Schedule rendering when data or the view changes. Keep idle interfaces idle and bound caches and repeated work.
- Use the existing `RidgelineError` and diagnostic mechanisms for library failures, preserving operation context and causes. Honor documented recovery behavior; avoid silent fallback or unbounded automatic retry.
- Isolate consumer callback failures so they cannot prevent cleanup or unrelated updates. Explain intentional error suppression where it occurs.

## Tests and verification

- Favor real consumer workflows through public interfaces. For package, export, rendering, or lifecycle changes, use the packaged-consumer browser suite so development aliases cannot hide integration failures.
- Test mouse and keyboard behavior with real browser input when gestures, focus, or event propagation are part of the change. Calling a handler or firing a synthetic map event alone does not verify that interaction.
- Use focused module tests for geometry, validation, and state transitions. Assert observable results and invariants, including relevant failure paths, rather than private call sequences.
- Use test doubles only where they preserve the failure mode being tested. Avoid source-text assertions and tests that merely restate the implementation.
- Run type checking and the checks covering the changed behavior. Validate affected consumers as well: the playground for playground integration and the control lab for its own changes. Broaden testing when the change crosses shared boundaries.
- Distinguish completed checks from manual observations and unverified behavior. Keep historical measurements dated rather than presenting them as current guarantees.

## Documentation

Document public behavior and integration examples in [README.md](README.md). Keep domain vocabulary in [CONTEXT.md](CONTEXT.md), decision rationale in [docs/adr/](docs/adr/), and feature requirements in their specs. Link to the authoritative document instead of copying its contract here.

Use comments for intent, ownership, and non-obvious constraints. Update them when behavior changes.

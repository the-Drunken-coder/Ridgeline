---
status: accepted
supersedes: ADR-0001 in part
---

# Position Ridgeline as a tactical mapping toolkit of core and packs

Ridgeline was framed as a general "easy MapLibre viewport", but its real users build operator and command-and-control style applications, and its built capabilities (airborne entities, sensor cameras, terrain visibility, vehicle models, symbology) are tactical. We now position it as a tactical mapping toolkit with a low barrier to entry: a small domain-neutral core, optional packs that carry the tactical capabilities, and a public extension API that both first-party and third-party packs use. Ridgeline displays geospatial information and lets users interact with it; it never moves or decides on data. This partially supersedes [ADR-0001](0001-consumer-owned-workflows.md).

## Decisions

- **Audience.** Developers building operator, command-and-control, public-safety, search-and-rescue and drone-operations applications. General MapLibre users can use the core, but they do not drive the roadmap.
- **Tactical scope.** A capability is in scope when it displays, measures or lets users interact with located things in 3D space over terrain. Data feeds, transport, messaging, tasking, authentication, persistence and mission workflows stay in applications.
- **Action requests.** A gesture such as "send this asset to that point" produces an action request for the application. The application decides, acts and draws any preview from ordinary features. A pack draws what the user is editing, such as a drawing draft; the application draws what it plans to do.
- **Core.** Viewport, features, styling, selection, events and camera. Core types know nothing about entities, models, sensors or military symbols.
- **Packs.** Any optional add-on, tactical or not, built only on the public API. Drawing, interactions, controls and entities are packs. Third parties can build their own. New first-party packs are built for real consumer demand, not speculatively.
- **Extension API.** A small public seam designed for packs, grown only when a real pack needs more. First-party packs use nothing private. It carries no stability promise before 1.0. Direct MapLibre access under [ADR-0002](0002-maplibre-extension-access.md) remains for rendering.
- **Customization.** Configure a pack's options, then compose your own behavior from core building blocks and pack outputs. Copying a pack's source is a last resort that is never designed for; a common need that forces it is a gap in configuration or composition.
- **Packaging.** One package with a subpath per pack. A pack moves to its own package only when it brings a heavy dependency.
- **Size.** Simplicity of use matters more than bytes. CI reports the size of the core and each pack without a hard cap; a large increase needs a stated reason.
- **Standards.** Symbology packs delegate to an existing renderer such as SIDC Kit. Ridgeline makes no military-standard compliance claim of its own.

## What changes from ADR-0001

Kept: applications own authentication, networking, persistence, business workflows, the clock, source history, retention and replay controls. The playground and Atlas remain ordinary consumers, and the library must work without their code. Ridgeline owns the current display snapshot, rendering resources and drafts of geometry the user is editing.

Superseded: ADR-0001's 2026-10-11 clarification gave interpolation and camera-follow policy to consumers. A pack may now provide display-side interpolation between samples the application supplies, track trails and follow-camera behavior, because these are reusable across tactical applications. The motion and replay controller removed on 2026-10-11 stays removed: the application still owns time.

## Considered options

- **Stay a general viewport.** Rejected because it misdescribes the audience and the built features, and keeps tactical work in an awkward, uncertain scope.
- **Become an off-the-shelf operator application.** Rejected because business workflows differ between applications and would make the library heavy and hard to adopt.
- **Publish today's private attachment internals as the extension API.** Rejected because they were shaped by implementation, not by what packs need.

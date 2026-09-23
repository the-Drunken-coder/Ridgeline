# Keep application workflows with consumers

Ridgeline owns a reusable interactive map viewport; consumers supply feature data and own authentication, application networking, persistence, and business workflows. Atlas can consume the library but contributes no dependency or special integration contract. This keeps the package usable in a standalone playground and unrelated applications, at the cost of requiring consumers to assemble their own application workflows.

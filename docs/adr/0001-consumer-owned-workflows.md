# Keep application workflows with consumers

Ridgeline's public API is designed for consuming applications generally; consumers supply feature data and own authentication, application networking, persistence, and business workflows. The playground and Atlas are ordinary consumers: the library must remain usable without their code, layouts, sample data, state, or workflows. A playground request belongs in the library only when it solves a reusable mapping need, and preserving this boundary takes precedence over shortcuts that make the playground easier to build.

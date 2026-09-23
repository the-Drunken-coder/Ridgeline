# Ridgeline

Ridgeline is a reusable interactive map viewport. Consumers supply geographic data and own the surrounding application workflows.

## Language

**Viewport**:
An interactive view of geographic features and their map context, defined by a camera and display capabilities.
_Avoid_: Map implementation, map engine

**Consumer**:
An application that uses Ridgeline to display and interact with geographic data.

**Feature**:
A geographic object with a stable identity and point, line, or polygon geometry. Icons and labels are visual representations associated with features.

**Feature ID**:
The stable identity by which a consumer and viewport refer to the same feature across updates. Its identity does not change when its name, appearance, or location changes.

**Display name**:
The human-readable name of a feature, used in hover information and picker choices. Different features can share a display name while retaining distinct feature IDs.

**Selection**:
The set of feature identities chosen by the consumer and displayed as selected in the viewport. A map interaction is an input to that choice, not the choice itself.

**Radial picker**:
A circular arrangement of feature choices used to disambiguate overlapping or closely packed features at a clicked location.
_Avoid_: Cluster, action menu

**Basemap**:
The background geographic content and its visual styling beneath consumer features.

**Projection**:
The way the geographic world is presented as a flat map or globe.

**Elevation data**:
Geographic height data from which terrain and hillshade are derived.

**Terrain**:
The elevated shape of the map surface.

**Hillshade**:
Shading derived from elevation data that makes the shape of the ground visible.

**Camera**:
The position and orientation of the view, including its geographic center, zoom, bearing, and pitch.

**Playground**:
A standalone application for developing and testing map experiences through the same public API available to consumers.

**Test scenario**:
A selectable playground example with sample features and interactions intended to exercise particular viewport capabilities.

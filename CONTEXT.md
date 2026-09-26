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
The position and orientation of the map view, including its geographic center, zoom, bearing, and pitch. A sensor camera is a separate concept.

**Playground**:
A standalone application for developing and testing map experiences through the same public API available to consumers.

**Test scenario**:
A selectable playground example with sample features and interactions intended to exercise particular viewport capabilities.

## Entities and attached geometry

**Entity**:
A located object that may move, have an altitude, and carry attached geometry.

**Altitude reference**:
The surface from which an entity's vertical position is measured, either the ground beneath it or sea level.

**Attachment**:
Geometry associated with an entity whose origin is the entity's center and whose placement follows that entity's location.

**Ground area**:
A two-dimensional region on the ground, including an attached zone beneath an entity.

**Airborne volume**:
A three-dimensional region in the air, including a zone surrounding an entity.

**Sensor camera**:
A camera carried by an entity, with a pointing direction and horizontal and vertical fields of view.
_Avoid_: Map camera

**Sensor bearing**:
The sensor's horizontal pointing direction clockwise from geographic north, independent of the entity's heading or travel direction. North is 0 degrees and east is 90 degrees.

**Sensor elevation angle**:
The sensor's vertical pointing direction relative to the local level horizon, with positive angles upward and negative angles downward. It is an angle, distinct from altitude or terrain elevation.

**Camera overlay**:
A four-sided directional polygon draped on terrain. Its boundary describes the camera direction and extent; optional terrain visibility divides its interior into approximately visible and hill-blocked regions.

**Terrain visibility**:
An estimate of whether hills obstruct the camera’s line of sight to ground inside its footprint. Missing elevation is unknown, not visible or blocked.

## Drawing

**Drawing**:
A geographic feature created through map drawing tools. Its meaning, such as a route or boundary, is assigned by the consumer.

**Ground drawing**:
A drawing whose geometry lies on the ground. It has no independent altitude or attachment to a moving feature.

**Drawing draft**:
A temporary version of a new or existing drawing that the consumer has not accepted. Discarding a draft leaves the accepted features unchanged.

**Shape definition**:
The defining geometry of a drawing, such as a circle's center and radius or an arrow's line. It preserves the drawing's shape-specific editing behavior.

**Accepted drawing change**:
A completed drawing change approved by the consumer. It is one application-history action, distinct from the individual actions used to prepare its draft.

**Editing session**:
Work on one drawing draft, including its geometry, appearance, and label. It ends when the consumer accepts the change or the user discards the draft.

**Vertex snapping**:
Positioning a drawing vertex at an eligible visible vertex. It copies the position without creating an attachment between features.

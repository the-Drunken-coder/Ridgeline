import { snapshotReviewCases } from './snapshots-review.browser';
import { renderingReviewCases } from './rendering-review.browser';
import { drawingReviewCases } from './drawing-review.browser';
import { groundAreaReviewCases } from './ground-area-review.browser';
import { modelFrameReviewCases } from './model-frame-review.browser';
import { modelRecoveryCases } from './model-recovery.browser';
import { modelPickingCases } from './model-picking.browser';
import { modelPresentationCases } from './model-presentation.browser';
import { modelPlacementCases } from './model-placement.browser';
import { modelSwitchingCases } from './model-switching.browser';
import { modelMaterialCases } from './model-materials.browser';
import { modelRegistrationCases } from './model-registration.browser';
import { workflowControlCases } from './workflow-controls.browser';
import { workflowDrawingCases } from './workflow-drawing.browser';
import { selectionWorkflowCases } from './workflow-selection.browser';
import { entityProjectionCases } from './entity-projection';
import { drawingProjectionCases } from './drawing-projection';
import { publicationReentryCases } from './publication-reentry';
import { interactionContentCases } from './interaction-content';
import { drawingOwnershipCases } from './drawing-ownership';
import { entityRecoveryCases } from './entity-recovery';
import { drawingInspectorCases } from './drawing-inspector';
import { viewportLifecycleCases } from './viewport-lifecycle';
import { featurePublicationCases } from './feature-publication';
import { pickerCases } from './picker';
import { viewportConfigurationCases } from './viewport-configuration';
import { entityTerrainCases } from './entity-terrain';
import { drawingPermissionsCases } from './drawing-permissions';
import { drawingEditingCases } from './drawing-editing';
import { drawingGroundInputCases } from './drawing-ground-input';
import { drawingGroundRecoveryCases } from './drawing-ground-recovery';
import { drawingGroundDemCases } from './drawing-ground-dem';
import { drawingShapesCases } from './drawing-shapes';
import { cameraCoverageCases } from './camera-coverage';
import { gpuVoteCaseCases } from './gpu-vote-case';

export const caseModules = [
  snapshotReviewCases,
  renderingReviewCases,
  drawingReviewCases,
  groundAreaReviewCases,
  modelFrameReviewCases,
  modelRecoveryCases,
  modelPickingCases,
  modelPresentationCases,
  modelPlacementCases,
  modelSwitchingCases,
  modelMaterialCases,
  modelRegistrationCases,
  workflowControlCases,
  workflowDrawingCases,
  selectionWorkflowCases,
  entityProjectionCases,
  drawingProjectionCases,
  publicationReentryCases,
  interactionContentCases,
  drawingOwnershipCases,
  entityRecoveryCases,
  drawingInspectorCases,
  viewportLifecycleCases,
  featurePublicationCases,
  pickerCases,
  viewportConfigurationCases,
  entityTerrainCases,
  drawingPermissionsCases,
  drawingEditingCases,
  drawingGroundInputCases,
  drawingGroundRecoveryCases,
  drawingGroundDemCases,
  drawingShapesCases,
  cameraCoverageCases,
  gpuVoteCaseCases
];

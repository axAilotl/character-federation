/**
 * @character-foundry/voxta
 *
 * Voxta package format reader, writer, and mapper.
 */

// Types
export type {
  CompressionLevel,
  VoxtaPackage,
  VoxtaTtsConfig,
  VoxtaScript,
  VoxtaCharacter,
  VoxtaBookItem,
  VoxtaBook,
  VoxtaAction,
  VoxtaScenario,
  ExtractedVoxtaAsset,
  ExtractedVoxtaCharacter,
  ExtractedVoxtaScenario,
  ExtractedVoxtaBook,
  VoxtaData,
  VoxtaReadOptions,
  VoxtaWriteAsset,
  VoxtaWriteOptions,
  VoxtaBuildResult,
  VoxtaExtensionData,
  VoxtaLossReport,
} from './types';

// Reader
export {
  isVoxta,
  readVoxta,
  readVoxtaAsync,
} from './reader';

// Writer
export {
  writeVoxta,
  writeVoxtaAsync,
} from './writer';

// Mapper
export {
  voxtaToCCv3,
  ccv3ToVoxta,
  ccv3LorebookToVoxtaBook,
} from './mapper';

// Macros
export {
  voxtaToStandard,
  standardToVoxta,
} from './macros';

// Loss reporting
export {
  checkVoxtaLoss,
  isVoxtaExportLossless,
  formatVoxtaLossReport,
} from './loss';

// Enricher
export {
  enrichVoxtaAsset,
  type EnrichedAssetMetadata,
} from './enricher';


// Public surface. Each part contributes one EXPORTS_* object; a part that is absent is skipped.
const Flipbook = {
  ...(typeof EXPORTS_CORE !== 'undefined' ? EXPORTS_CORE : {}),
  ...(typeof EXPORTS_DRY !== 'undefined' ? EXPORTS_DRY : {}),
  ...(typeof EXPORTS_MEDIA !== 'undefined' ? EXPORTS_MEDIA : {}),
  ...(typeof EXPORTS_LETTERS !== 'undefined' ? EXPORTS_LETTERS : {}),
  ...(typeof EXPORTS_MOTION !== 'undefined' ? EXPORTS_MOTION : {}),
  ...(typeof EXPORTS_ANIM !== 'undefined' ? EXPORTS_ANIM : {}),
  ...(typeof EXPORTS_FLOW !== 'undefined' ? EXPORTS_FLOW : {}),
  ...(typeof EXPORTS_INPUTS !== 'undefined' ? EXPORTS_INPUTS : {})
};

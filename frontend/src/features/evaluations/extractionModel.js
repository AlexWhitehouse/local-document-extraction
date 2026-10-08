// Whether a model candidate can become the workspace extraction model, and the model it would save.
// The candidate's input settings are the capabilities it ran with, so they carry over with its model.
// `results` are the candidate's results across documents; a model is only promoted as it was tested.
export function extractionModelAvailability(configuration, candidate, results = []) {
  const model = {
    model_name: candidate.model.trim(),
    supports_pdf_input: !!candidate.pdf,
    supports_structured_output: !!candidate.structured,
  };

  const unavailable = (reason) => ({ reason, model });
  const record = configuration?.record;

  if (!record || configuration.loading) return unavailable("Loading the Model gateway…");

  if (!record.configured) return unavailable("Set up the Model gateway first.");

  if (record.credential_status !== "configured")
    return unavailable("The saved API key can’t be read. Fix the Model gateway first.");

  if (configuration.conflict) return unavailable("The Model gateway changed elsewhere. Reload it first.");

  if (!model.model_name) return unavailable("Enter a model first.");

  if (model.model_name.length > 256 || /[\r\n\0]/.test(model.model_name))
    return unavailable("Use a model name of up to 256 characters on one line.");

  const tested = results.some(
    (result) =>
      result?.model === model.model_name &&
      !!result.pdf === model.supports_pdf_input &&
      !!result.structured === model.supports_structured_output,
  );

  if (!tested) return unavailable("Run this candidate with these settings first.");

  if (
    record.model_name === model.model_name &&
    record.supports_pdf_input === model.supports_pdf_input &&
    record.supports_structured_output === model.supports_structured_output
  )
    return unavailable("This is already the extraction model.");

  return { reason: "", model };
}

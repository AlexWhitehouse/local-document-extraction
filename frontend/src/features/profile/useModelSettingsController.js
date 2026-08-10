import { useEffect, useState } from "react";
import { toast } from "sonner";

export function useModelSettingsController({
  coreRequest,
  hasSession,
  addLog,
}) {
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [savedGatewayUrl, setSavedGatewayUrl] = useState("");
  const [savedModelName, setSavedModelName] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (hasSession) {
      return;
    }
    setGatewayUrl("");
    setModelName("");
    setApiKey("");
    setSavedGatewayUrl("");
    setSavedModelName("");
    setHasApiKey(false);
    setIsLoaded(false);
    setError("");
  }, [hasSession]);

  async function loadSettings() {
    if (isLoading || isLoaded) {
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const settings = await coreRequest("/settings/model", { method: "GET" });
      applySettings(settings);
      setIsLoaded(true);
    } catch (loadError) {
      const message = loadError.message || "Model settings could not be loaded.";
      setError(message);
      addLog(`Model settings load failed: ${message}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveSettings() {
    const normalizedGatewayUrl = gatewayUrl.trim();
    const normalizedModelName = modelName.trim();
    if (!normalizedGatewayUrl || !normalizedModelName) {
      setError("Gateway URL and model name are required.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const settings = await coreRequest("/settings/model", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gateway_url: normalizedGatewayUrl,
          model_name: normalizedModelName,
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        }),
      });
      applySettings(settings);
      setApiKey("");
      setIsLoaded(true);
      addLog("Model settings updated");
      toast.success("Model settings saved.");
    } catch (saveError) {
      const message = saveError.message || "Model settings could not be saved.";
      setError(message);
      addLog(`Model settings update failed: ${message}`);
      toast.error("Model settings could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function removeApiKey() {
    if (!gatewayUrl.trim() || !modelName.trim()) {
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const settings = await coreRequest("/settings/model", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gateway_url: gatewayUrl.trim(),
          model_name: modelName.trim(),
          api_key: null,
        }),
      });
      applySettings(settings);
      setApiKey("");
      addLog("Model API key removed");
      toast.success("Model API key removed.");
    } catch (removeError) {
      const message = removeError.message || "Model API key could not be removed.";
      setError(message);
      addLog(`Model API key removal failed: ${message}`);
      toast.error("Model API key could not be removed.");
    } finally {
      setIsSaving(false);
    }
  }

  function applySettings(settings) {
    const nextGatewayUrl = String(settings?.gateway_url || "");
    const nextModelName = String(settings?.model_name || "");
    setGatewayUrl(nextGatewayUrl);
    setModelName(nextModelName);
    setSavedGatewayUrl(nextGatewayUrl);
    setSavedModelName(nextModelName);
    setHasApiKey(Boolean(settings?.has_api_key));
  }

  return {
    gatewayUrl,
    modelName,
    apiKey,
    hasApiKey,
    isDirty:
      gatewayUrl.trim() !== savedGatewayUrl ||
      modelName.trim() !== savedModelName ||
      Boolean(apiKey.trim()),
    isLoaded,
    isLoading,
    isSaving,
    error,
    onGatewayUrlChange: setGatewayUrl,
    onModelNameChange: setModelName,
    onApiKeyChange: setApiKey,
    onLoad: loadSettings,
    onSave: saveSettings,
    onRemoveApiKey: removeApiKey,
  };
}

export function modelsConfigApiPath(path: string, corporate: boolean): string {
  if (!corporate) return path;
  if (path !== "/api/models-config" && !path.startsWith("/api/models-config/")) {
    throw new Error("Корпоративный редактор не обращается к личным провайдерам");
  }
  return path.replace("/api/models-config", "/api/multi/admin/models-config");
}

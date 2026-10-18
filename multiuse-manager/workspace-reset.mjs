// Serialize ensure/reset for the same worker; a login must not restart a worker
// while the privileged manager is modifying its files.
const queues = new Map();
export async function serialize(key, run) {
  const previous = queues.get(key) || Promise.resolve();
  const result = previous.catch(() => {}).then(run);
  queues.set(key, result);
  try { return await result; } finally { if (queues.get(key) === result) queues.delete(key); }
}

export async function resetStoppedWorker({ name, docker, apply, start, wait }) {
  let wasRunning = false;
  try {
    const info = await docker("GET", `/containers/${name}/json`);
    wasRunning = Boolean(info.State.Running);
    if (wasRunning) await docker("POST", `/containers/${name}/stop?t=10`);
  } catch (error) { if (!String(error).includes(" 404 ")) throw error; }
  let result;
  let failure;
  try { result = await apply(); } catch (error) { failure = error; }
  if (wasRunning && !failure?.keepStopped) {
    try { await start(name); await wait(`http://${name}:30141`); }
    catch {
      throw new Error(failure
        ? `Пересоздание не выполнено: ${failure.message}. Не удалось снова запустить worker.`
        : "Шаблон обновлён, но worker не запустился. Повторите вход сотрудника.");
    }
  }
  if (failure) throw failure;
  return { ...result, worker: wasRunning ? "running" : "stopped" };
}

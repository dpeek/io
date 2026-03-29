export function handleExit(cb: () => Promise<void>) {
  let stopping = false;
  const stopOnce = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    await cb();
  };

  const handleSignal = () => {
    void stopOnce().finally(() => process.exit(0));
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  process.once("SIGQUIT", handleSignal);
  process.once("beforeExit", () => stopOnce());
  process.once("exit", () => stopOnce());
}

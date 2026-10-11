import type { AddressInfo, Server } from 'node:net';

/**
 * Binds a server and resolves with the bound address (port 0 picks a free
 * port), or rejects with the bind error, e.g. EADDRINUSE.
 */
export function listen(
  server: Server,
  port: number,
  host: string,
): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address() as AddressInfo);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ port, host, exclusive: true });
  });
}

/** A readable description of a failed bind, naming the option to change. */
export function describeListenError(
  error: unknown,
  service: string,
  option: string,
  host: string,
  port: number,
): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case 'EADDRINUSE': {
      return `${service} port ${port} on ${host} is already in use; stop the other process or choose another ${option}`;
    }
    case 'EACCES': {
      return `${service} may not listen on port ${port} on ${host}; choose a port above 1023 with ${option}`;
    }
    case 'EADDRNOTAVAIL': {
      return `${host} is not an address of this machine; check --host`;
    }
    default: {
      return `${service} could not listen on ${host}:${port}: ${(error as Error).message}`;
    }
  }
}

import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';

// Two tiny stand-ins for the outside world, so the stack never talks to a real third party:
//  - a fake payment gateway page (the worker's VNPay `redirectUrl` points here);
//  - an SMTP sink that accepts and discards every message (the worker's transactional email).

export function startGatewayStub(port: number): Promise<HttpServer> {
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Fake gateway</title><h1>Fake payment gateway</h1>');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

export function startSmtpSink(port: number): Promise<TcpServer> {
  const server = createTcpServer((socket) => {
    let inData = false;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', () => undefined);
    socket.write('220 e2e-sink ESMTP\r\n');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write('250 queued\r\n');
          continue;
        }
        const eol = buffer.indexOf('\r\n');
        if (eol === -1) return;
        const line = buffer.slice(0, eol).toUpperCase();
        buffer = buffer.slice(eol + 2);
        if (line.startsWith('EHLO') || line.startsWith('HELO')) {
          socket.write('250 e2e-sink\r\n');
        } else if (line === 'DATA') {
          inData = true;
          socket.write('354 end with <CRLF>.<CRLF>\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 bye\r\n');
          return;
        } else {
          socket.write('250 ok\r\n');
        }
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

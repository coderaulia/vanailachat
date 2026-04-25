const { ReadableStream } = require('node:stream/web');

async function test() {
  const stream = new ReadableStream({
    start(controller) {
      setTimeout(() => {
        try {
          controller.enqueue('test');
          console.log('Enqueued');
        } catch (e) {
          console.error('Error enqueuing:', e);
        }
      }, 100);
    }
  });

  const reader = stream.getReader();
  reader.cancel('client disconnected');
}

test();

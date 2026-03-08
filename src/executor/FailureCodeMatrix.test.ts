function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  assert(false, 'TODO: implement full failure-code matrix validation');
}

run();

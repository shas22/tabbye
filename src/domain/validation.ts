import { z } from 'zod';

// Extension CSP forbids dynamic code generation. Disable both Zod's JIT parser
// and its Function() capability probe before any schemas are constructed.
z.config({ jitless: true });

export { z };

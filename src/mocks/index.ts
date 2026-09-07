import type { Mock } from './defineMock';
import heistTest from './heist-test';
import brokenRefs from './broken-refs';

/**
 * Every scenario the dev panel can offer, and every one `?mock=<name>` can name.
 *
 * Registration is an explicit import rather than a glob so the bundler keeps them, and so adding a
 * scenario is a visible one-line change rather than a file appearing by magic.
 */
const MOCKS: readonly Mock[] = [heistTest, brokenRefs];

const BY_NAME = new Map(MOCKS.map((mock) => [mock.name, mock]));

export function getMock(name: string): Mock | undefined {
    return BY_NAME.get(name);
}

export function allMocks(): readonly Mock[] {
    return MOCKS;
}

export { defineMock } from './defineMock';
export type { Mock } from './defineMock';

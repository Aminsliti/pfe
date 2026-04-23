import '@testing-library/jest-dom';

if (!global.fetch || !jest.isMockFunction(global.fetch)) {
  global.fetch = jest.fn();
}

if (!global.ResizeObserver) {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!global.URL.createObjectURL) {
  global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
}

if (!global.matchMedia) {
  global.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

beforeEach(() => {
  if (jest.isMockFunction(global.fetch)) {
    global.fetch.mockReset();
  }
});

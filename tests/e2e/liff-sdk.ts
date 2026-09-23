// Bundled only by a localhost-only build. Production always imports the real SDK.
const liff = {
  async init() {},
  isLoggedIn: () => true,
  getAccessToken: () => sessionStorage.getItem('lino-e2e-line-token'),
  login() { throw new Error('Unexpected login in isolated fixture'); },
};
export default liff;

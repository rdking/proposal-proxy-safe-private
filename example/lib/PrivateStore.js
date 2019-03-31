const PrivateStore = (() => {
  return class PrivateStore {
    constructor(lock, pvt = {}) {
      return new Proxy(pvt, new Proxy({}, {
        data: {
          defaults: { //All other defaults are false
            get: void 0,
            getPrototypeOf: null,
            getOwnPropertySymbols: [],
            getOwnPropertyDescriptor: void 0,
            isExtensible: true,
            ownKeys: [],
            apply: void 0
          },
          enabled: false
        },
        get(target, prop, receiver) {
          let dflt = (prop in this.data.defaults) ? this.data.defaults[prop] : false;
          let condition = this.data.enabled;
          let self = this;

          return function(...args) {
            let retval = dflt;
            let key = args[1];

            if ((key === lock) && (prop == "set")) {
              self.data.enabled = args[2];
              retval = true;
            }
            else {
              if (["get", "has", "set"].includes(prop))
                condition = condition || (key === lock);

              if (condition)
                retval = Reflect[prop](...args);
            }

            return retval;          
          }
        }
      }));
    }
  };
})();

module.exports = PrivateStore;

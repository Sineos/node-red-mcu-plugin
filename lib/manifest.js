const clone = require("clone")
const path = require("path");
const fs = require("fs-extra");
// const pkgContents = require('@npmcli/installed-package-contents')


// RDW 20220821: https://github.com/ai/nanoid/issues/364
// There's a BREAKING CHANGE @nanoid.v4 supporting only ES6. Thus we stick to v<4!
const { customAlphabet } = require('nanoid');

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const nanoid = customAlphabet(alphabet, 16);

// https://github.com/stefanpenner/resolve-package-path
const resolve_package_path = require('resolve-package-path')

class manifest_builder {

    constructor(library, mcu_modules_path) {
        if (!library || !mcu_modules_path) {
            throw ("manifest_builder: Mandatory constructor arguments missing.")
        }
        this.nodes_library = library
        this.mcu_modules_path = mcu_modules_path;
        this.manifest = {};
        this.resolver_paths = [];
        this.initialize();
    }

    initialize(init) {
        if (typeof(init) === "string") {
            this.manifest = JSON.parse(init);
        } else if (typeof(init) === "object"){
            this.manifest = clone(init);
        }
        return true;
    }

    get_manifest_of_module(module, optional_path) {

        // console.log(`Trying to find 'manifest.json' for module "${module}":`);

        if (typeof(optional_path) !== "string") {
            throw 'typeof(optional_path) has to be "string"!'
        }

        let package_path;

        for (let i=0; i<this.resolver_paths.length; i+=1) {
            package_path = resolve_package_path(module, this.resolver_paths[i]);
            if (package_path) {
                break;
            }
        }
        
        if (!package_path) {
            throw `Unable to resolve path for module "${module}".`;
        }

        let module_path = path.dirname(package_path);

        // the most convenient situation: there is a manifest for this node type!
        let manifest_path = path.join(module_path, "mcu", "manifest.json");
        
        // accept as well a "manifest.json" in the nodes root directory
        let deprecated_path = path.join(module_path, "manifest.json");

        // Next best: We've a manifest template provided predefined in our mcu_nodes folder
        let scoped_module = module.split("/");
        let mn_path = path.join(this.mcu_modules_path, ...scoped_module, "manifest.json");

        let paths_to_check = [manifest_path, deprecated_path, mn_path];

        // Perhaps there's already a manifest.json in the (optionally) provided path
        if (optional_path) {
            paths_to_check.push(path.join(optional_path, ...scoped_module, "manifest.json"))
        }

        for (let i=0; i<paths_to_check.length; i+=1) {
            let p = paths_to_check[i];
            if (fs.existsSync(p)) {
                let mnfst = require(p);
                if (mnfst["//"]?.template !== undefined) {
                    // don't accept templates
                    continue;
                } else {
                    // console.log(`"manifest.json" found @ ${p}`);
                    return p;    
                }
            }
        }
        return;
    }

    include_manifest(path) {
        if (!this.manifest) {
            if (this.initialize() === false) {
                return false;
            }
        }
        if (!this.manifest.include) {
            this.manifest.include = [];
        }

        if (this.manifest.include.indexOf(path) < 0) {
            this.manifest.include.push(path);
            return true;
        }
        
        return false;
    }

    create_manifests_for_module(module, destination) {

        // console.log(`Creating 'manifest.json' for module "${module}":`);

        let package_path;

        for (let i=0; i<this.resolver_paths.length; i+=1) {
            package_path = resolve_package_path(module, this.resolver_paths[i]);
            if (package_path) {
                break;
            }
        }
        
        if (!package_path) {
            throw `Unable to resolve path for module "${module}".`;
        }

        let pckge = require(package_path);
        // ToDo: Send sth to console
        if (!pckge) return;

        // console.log(pckge);

        // split the module name to get its scope
        let scoped_module = module.split("/");

        // check if there is a template in mcu_nodes
        let template_path = path.join(this.mcu_modules_path, ...scoped_module, "manifest.json");
        let mnfst_template;
        let template;
        if (fs.existsSync(template_path)) {
            mnfst_template = require(template_path);
            template = mnfst_template["//"]?.template;
            if (template === undefined) {
                // sorry... this is not a template!
                mnfst_template = undefined;
            }
        }

        console.log(mnfst_template);

        // This is the name of the module that we need to make available
        // We could use module here as well ... ??
        let _module = pckge.name;

        // #1: exports.import (as we prefer to be "import"ed modules)
        // #2: exports.require (despite this will create issues...)
        // #2: main - which is most likely == exports.require
        // default acc. doc: "./index.js" if main not defined
        let _file = pckge.exports?.import ?? pckge.exports?.require ?? pckge.main ?? "./index.js";
        
        // _file was defined w/ "". Treat this as "there's no entry point"!
        // This may be the case for "@types" files.
        if (_file === "") {
            console.log(`${_module}: Skipped as package entry point voided.`)
            return;
        }
        
        let _path = path.resolve(path.dirname(package_path), _file);

        if (fs.pathExistsSync(_path)) {
            // check if it is a dir
            if (fs.lstatSync(_path).isDirectory()) {
                _path = path.resolve(_path, "./index.js")
            }
        } else {
            if (path.extname(_path).length < 1) {
                _path += ".js";
            }
        }
        
        if (fs.pathExistsSync(_path) !== true) {
            console.log("Path not found: " + _path);
            return;
        }

        // prepare the dir for this manifest
        let mnfst_path = path.join(destination, ...scoped_module, "manifest.json");
        fs.ensureDirSync(path.dirname(mnfst_path));

        /*  template: {
        *       "modules": ['name of module to be resolved & included', 'another name', '* == all']
        *   }
        */
        function check_template(section, key) {
            if (!template) return true;

            let keys = template[section] ?? []
            for (let i = 0; i < keys.length; i++) {
                if (keys[i] === key || keys[i] == "*") {
                    return true;
                }
            }
            return false;
        }

        // make module path & create symlink if necessary
        if (check_template("modules", _module)) {

            let _ext = "";
            let _p = _path
            let _pp;
            let _name;
    
            do {
                _name = _pp?.name ?? "";
                _pp = path.parse(_p)
                // console.log(_pp);
                _ext = _pp.ext + _ext;
                _p = _p.slice(0, -_ext.length);
            } while (_pp.ext !== "")
    
    
            // Moddable will only resolve ".js" files
            // In case the extension is sth else, create a symlink
            if (_ext !== ".js") {
                
                let _link;
                do {
                    _link = `${_name}-${_ext.replace(/\./g, "")}-${nanoid()}.js`
                    _link = path.join(path.dirname(mnfst_path), _link)    
                } while (fs.existsSync(_link));
    
                fs.symlinkSync(_path, _link);
                _path = _link;
            }    
        }

        let mnfst = {
            "//": {
                "***": "https://github.com/ralphwetzel/node-red-mcu-plugin",
                "npm": `${module}`,
                "xs": "manifest.json",
                "@": `${new Date(Date.now()).toJSON()}`,
                "ref": "https://github.com/Moddable-OpenSource/moddable"
            },
            "build": {},
            "include": [],
            "modules": {
                "*": [],
            }
        }

        let bldr = new manifest_builder(this.nodes_library, this.mcu_modules_path);
        // console.log(bldr);

        if (mnfst_template) {
            
            // if we don't clone here, we'll get the modified mnfst @ the next require call! 
            let mt = clone(mnfst_template)

            // this eliminates the "template" property of mt/mnfst_template!
            mt["//"] = clone(mnfst["//"]);
            
            // to be sure...
            mt.build ??= {};
            mt.include ??= [];
            mt.modules ??= { "*": [] };

            bldr.initialize(mt);
        } else {
            bldr.initialize(clone(mnfst));
        }

        bldr.resolver_paths = this.resolver_paths;

        let _MCUMODULES = false
        if (check_template("build", "MCUMODULES")){
            // first: define MCUMODULES
            bldr.add_build("MCUMODULES", this.mcu_modules_path);
            _MCUMODULES = true;
        }

        if (check_template("include", "require")){
            // Make "require" available
            let _require = _MCUMODULES ? "$(MCUMODULES)" : this.mcu_modules_path
            bldr.include_manifest(`${_require}/require/manifest.json`);
        }

        if (check_template("modules", _module)) {
            // explicitely add with the import name and the path (or symlink)
            let _pp = path.parse(_path);
            if (_pp.ext.length > 0) {
                _path = _path.slice(0, -_pp.ext.length);
            }
            bldr.add_module(_path, _module);

        }

        // Write this initial manifest to disc
        // to ensure that it's found on further iterations
        // thus to stop the iteration!
        console.log(mnfst_path);
        // console.log(bldr.get());

        fs.writeFileSync(mnfst_path, bldr.get(), (err) => {
            if (err) {
                throw err;
            }
        });

        let changed = false;

        // console.log(`Checking dependencies of module "${module}":`);

        let deps = pckge.dependencies;
        if (deps) {
            for (let key in deps) {
                if (check_template("include", key)) {
                    let mnfst = this.get_manifest_of_module(key, destination);
                    if (mnfst && typeof (mnfst) === "string") {
                        bldr.include_manifest(mnfst);
                        changed = true;
                        continue;
                    }
                    mnfst = this.create_manifests_for_module(key, destination);
                    if (mnfst && typeof(mnfst) === "string") {
                        bldr.include_manifest(mnfst);
                        changed = true;
                    }
                }
            }
        }

        if (changed === true) {
            fs.ensureDirSync(path.dirname(mnfst_path));
            fs.writeFileSync(mnfst_path, bldr.get(), (err) => {
                if (err) {
                    throw err;
                }
            });    
        }

        return mnfst_path;
    }

    add_build(key, value) {
        if (!this.manifest.build) {
            this.manifest.build = {}
        }
        this.manifest.build[key] = value;
    }

    add_module(_path, key) {

        key = key ?? "*";
        if (typeof(key) !== "string") throw("typeof(key) must be string.")

        if (!this.manifest) {
            if (this.initialize() === false) {
                return false;
            }
        }

        if (!this.manifest.modules) {
            this.manifest.modules = {
                "*": [],
                "~": []
            };
        }

        if (!this.manifest.modules[key]) {
            this.manifest.modules[key] = _path;
            return true;
        }

        let mms = this.manifest.modules[key];
        if (Array.isArray(mms)) {
            if (mms.indexOf(_path) < 0) {
                mms.push(_path);
                return true;
            }        
        } else if (_path !== mms) {
            this.manifest.modules[key] = [ mms, _path]
            return true;
        }

        return false;
    }

    add_preload(module) {
        if (!this.manifest.preload) {
            this.manifest.preload = []
        }
        if (this.manifest.preload.indexOf(module) < 0) {
            this.manifest.preload.push(module);
        }        
    }

    // create_manifests_from_package

    get() {
        return JSON.stringify(this.manifest, null, "  ");
    }

    add(object, key) {
        this.manifest[key] = clone(object);
    }
}


module.exports = {
    builder: manifest_builder
}
import * as request             from 'request';
import * as fs                  from 'fs';
import * as ui5                 from './ui5api';
import TreeNode                 from './nodeTypes/base/TreeNode';
import TreeBuilder              from './nodeTypes/base/TreeBuilder';
import Config, { LocalConfig }  from './GeneratorConfig';

export default class Generator
{
    private config: Config;
    private localConfig: LocalConfig;

    public constructor(configPath: string, localConfigPath: string) {
        var jsonConfig      = fs.readFileSync(configPath, { encoding: "utf-8" });
        var localJsonConfig = fs.readFileSync(localConfigPath, { encoding: "utf-8" });

        this.config      = JSON.parse(jsonConfig);
        this.localConfig = JSON.parse(localJsonConfig);
    }

    public generate(): void
    {
        let versions = this.config.input.versions;
        this.generateVersions(versions);
    }

    private generateVersions(versions: string[]): void {
        if (fs.existsSync("./exports")) {
            fs.rmdirSync("./exports", { recursive: true });
            if (fs.existsSync("./exports")) fs.rmdirSync("./exports", { recursive: true });
            if (fs.existsSync("./exports")) fs.rmdirSync("./exports");
            if (fs.existsSync("./exports")) fs.rmdirSync("./exports");
            if (!fs.existsSync("./exports")) fs.mkdirSync("./exports");
        }else{
            fs.mkdirSync("./exports");
        }
        if (versions.length) {
            let version = versions[0];
            
            console.log(`Starting generation of version ${version}...`);

            var requests = this.config.input.namespaces.map(namespace => this.getApiJson(namespace, version));
            
            console.log(`All requests made.`);

            Promise.all(requests)
                .then(apiList => {
                    this.execute(apiList, version);
                    console.log(`Generation of version ${version} complete.`);

                    this.generateVersions(versions.slice(1))
                })
                .catch(error => {
                    console.log("\x1b[31m", `\n\n  Error: ${error}\n\n  Stack:${error.stack}`);
                    process.exit(1);
                });
        }
    }
    
    private getApiJson(namespace: string, version: string): Promise<ui5.API>
    {
        const versionMarker = "{{VERSION}}";

        if (this.localConfig.runLocal) {
            let path = `${this.localConfig.path}/${namespace}/${this.config.input.jsonLocation}`
                .replace(/\//g, "\\")
                .replace(versionMarker, version);

            console.log(`Making local file '${path}'`);

            return new Promise((resolve: (api: ui5.API) => void, reject: (error: any) => void) => {
                fs.readFile(path, { encoding: "utf-8" }, (err, data) => {
                    if (!err) {
                        console.log(`Got content from '${path}'`);
                        resolve(JSON.parse(data))
                    }
                    else {
                        console.log(`Got error from '${path}'`);
                        reject(`${err}`);
                    }
                });
            });
        }
        else {
            let url = `${this.config.input.apiBaseUrl}/${namespace}/${this.config.input.jsonLocation}`
                .replace(versionMarker, version);
            
            console.log(`Making request to '${url}'`);

            return new Promise((resolve: (api: ui5.API) => void, reject: (error: any) => void) => {
                request({ url: url, json: true }, (error, response, body) => {
                    if (!error && response && response.statusCode === 200) {
                        console.log(`Got response from '${url}'`);
                        resolve(response.body);
                    }
                    else {
                        console.log(`Got error from '${url}'`);
                        reject(`${response.statusCode} - ${response.statusMessage}`);
                    }
                });
            });
        }
    }
    
    private execute(apiList: ui5.API[], version: string): void
    {
        this.createExports(apiList);
        // console.clear();
        console.log("All apis downloaded!");
        this.createDefinitions(apiList, version);
    }

    private createDefinitions(apiList: ui5.API[], version: string): void
    {
        console.log("createDefinitions");
        let allSymbols = apiList.map(api => api.symbols).reduce((a, b) => a.concat(b));

        allSymbols.sort((a, b) => a.name.localeCompare(b.name));

        let rootNodes = TreeBuilder.createFromSymbolsArray(this.config, allSymbols);
        for (var node of rootNodes) {
            if (node && node["name"]) {
                console.log(`createDefinitions: ${node.name}`);
                let output: string[] = [];
                let tsCode = node.generateTypeScriptCode(output);
                // this.createFile(`${this.config.output.definitionsPath}${version.replace(/[.]\d+$/, "")}/${node.fullName}.d.ts`, output.join(""));
                this.createFile(`${this.config.output.definitionsPath}${version}/${node.fullName}.d.ts`, output.join(""));
            }
        }

        // Uncomment this to see the details, statistics and example values of the different types of API members
        // this.printApiData(allSymbols);
    }

    /**
     * This method just print api data to help identify and understand de API structure and define it in ui5api.ts
     * @param symbols Symbols array
     */
    private printApiData(symbols: ui5.Symbol[]): void
    {
        var result: { [name: string]: any } = {};
        var object: { [name: string]: any[] } = {};

        symbols.forEach(s => (object[s.kind] = object[s.kind] || []).push(s));

        this.addToResult(result, object);

        console.log(result);
    }

    private addToResult(result: { [name: string]: any }, object: any): void
    {
        let storageValuesFrom = [
            "kind",
            "visibility",
            "static",
            "final",
            "abstract",
            "optional",
            "defaultValue",
            "$keyEqualsName"
        ];

        let treatAsArray = [
            "parameterProperties"
        ];

        if (Array.isArray(object)) {
            if (object.length > 0 && typeof(object[0]) === "object") {
                result.$length = (result.$length || 0) + object.length;
                object.forEach(o => this.addToResult(result, o));
            }
            else {
                result.$examples = result.$examples || [];
                if (result.$examples.length < 5) result.$examples.push(object);
            }
        }
        else {
            if (object && object.hasOwnProperty("defaultValue")) {
                object.defaultValue = typeof(object.defaultValue) + "[" + object.defaultValue + "]";
            }
            for (let key in object) {
                if (object.hasOwnProperty(key)) {
                    let value = object[key];
                    key = key === "constructor" ? "_constructor" : key;

                    result[key] = result[key] || { $count: 0 };
                    result[key].$count++;

                    if (typeof(value) === "object") {
                        if (treatAsArray.indexOf(key) > -1) {
                            let array: any[] = [];
                            for (var k in value) {
                                value[k].$keyEqualsName = k === value[k].name;
                                array.push(value[k]);
                            }
                            value = array;
                        }
                        this.addToResult(result[key], value);
                    }
                    else {

                        if (storageValuesFrom.indexOf(key) > -1) {
                            result[key][value] = result[key][value] || 0;
                            result[key][value]++;
                        }
                        else {
                            result[key].$examples = result[key].$examples || [];
                            if (result[key].$examples.length < 5 && result[key].$examples.indexOf(value) === -1) {
                                result[key].$examples.push(value);
                            }
                        }
                    }
                }
            }
        }
    }

    private createExports(apiList: ui5.API[]): void
    {
        apiList.forEach(api => api.symbols.forEach(s => this.exportSymbol(s)));
    }
    
    private exportSymbol(symbol: ui5.Symbol): void
    {
        if (symbol.name.match(/^jquery/i))
        {
            return;
        }
    
        if (symbol.kind == "namespace" && symbol.name.replace(/[.]/g, "/") === symbol.module)
        {
            var path = this.config.output.exportsPath + symbol.resource.replace(/[.]js$/g, ".d.ts");
            var content = `export default ${symbol.name};`
    
            this.createFile(path, content);
        }
        else if (symbol.kind === "class")
        {
            var path = this.config.output.exportsPath + symbol.name.replace(/[.]/g, "/") + ".d.ts";
            var content = `export default ${symbol.name};`
    
            this.createFile(path, content);
        }
    }
    
    private createFile(path: string, content: string): void
    {
        var _path = path;
        if (_path.indexOf(":") > -1){
            _path = _path.split(":").join("/");
        }
        var dirPieces = _path.replace(/\/[^/]+$/, "").split("/");
    
        // make sure that the directory exists
        for (let i = 0, dir = dirPieces[0]; i < dirPieces.length; i++, dir += `/${dirPieces[i]}`)
        {
            // const dirCleaned = dir.split(":").join("_")
            if (!fs.existsSync(dir))
            {
                fs.mkdirSync(dir);
            }
        }
    
        // write the file
        try{
            fs.writeFileSync(_path,content);
        } catch(err) {
            if(err) {
                return console.log(err);
            }
        }
        // fs.writeFile(path, content, (err: any) => {
        //     if(err) {
        //         return console.log(err);
        //     }
        
        //     //console.log(`File saved: ${path}`);
        // });
    }
}


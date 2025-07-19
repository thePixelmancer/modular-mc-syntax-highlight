# ModularMC Syntax Highlighting

A Visual Studio Code extension that provides TypeScript syntax highlighting within various file types for the ModularMC regolith filter.

## Features

This extension enhances your development experience by injecting TypeScript syntax highlighting into:

- **JSON files** - Inline TypeScript within string values
- **Plain text files** - Block and inline TypeScript code
- **Lang files** (`.lang`) - Block TypeScript code for ModularMC

### Supported Syntax Patterns

#### 1. Inline TypeScript in JSON
Highlight TypeScript code within JSON string values that start with `::`:

```json
{
  "script": "::console.log('Hello, World!')",
  "handler": "::function process(data) { return data.map(x => x * 2); }"
}
```

#### 2. Block TypeScript in Plain Text and Lang Files
Multi-line TypeScript code blocks using `{ts: ... :}` syntax:

```plaintext
Normal text content

{ts:
let x = 5;
function hello() {
  console.log(x);
}
:}

More text content
```

#### 3. Inline TypeScript in Plain Text
Inline TypeScript within quoted strings using `::` prefix:

```plaintext
Some text "::const greeting = 'Hello';" more text
```

## Installation

### From Source
1. Clone this repository
2. Open in VS Code
3. Press `F5` to launch the Extension Development Host
4. Test the extension with the provided example files in the `test/` directory

### From VSIX (when published)
1. Download the `.vsix` file
2. Open VS Code
3. Go to Extensions view (`Ctrl+Shift+X`)
4. Click the "..." menu and select "Install from VSIX..."
5. Select the downloaded file

## File Support

| File Type | Extension | Syntax Support |
|-----------|-----------|----------------|
| JSON | `.json` | Inline TypeScript (`::...`) |
| Plain Text | `.txt` | Block (`{ts: ... :}`) and Inline (`"::..."`) |
| Lang Files | `.lang` | Block TypeScript (`{ts: ... :}`) |

## Usage Examples

### JSON Files
```json
{
  "processor": "::data => data.filter(item => item.active)",
  "validator": "::function validate(input) { return input.length > 0; }"
}
```

### Lang Files
```
# ModularMC Lang File

{ts:
interface Player {
  name: string;
  level: number;
}

function processPlayer(player: Player) {
  return `${player.name} (Level ${player.level})`;
}
:}
```

### Plain Text Files
```
Configuration notes:

{ts:
const config = {
  apiUrl: 'https://api.example.com',
  timeout: 5000
};
:}

Processing instruction: "::item => item.id"
```

## Extension Architecture

This extension uses TextMate grammar injection to provide syntax highlighting:

- **Grammar Files**: Located in `syntaxes/` directory
  - `json-injection.tmLanguage.json` - JSON string injection
  - `plain-injection.tmLanguage.json` - Plain text injection  
  - `lang-injection.tmLanguage.json` - Lang file injection

- **Language Configuration**: `language-configuration.json` for `.lang` files

- **Embedded Language**: All injections map to TypeScript (`typescript`) for consistent highlighting

## Development

### Project Structure
```
modular-mc-syntax-highlight/
├── package.json                 # Extension manifest
├── language-configuration.json  # Lang file configuration
├── syntaxes/
│   ├── json-injection.tmLanguage.json
│   ├── plain-injection.tmLanguage.json
│   └── lang-injection.tmLanguage.json
└── test/
    ├── some.json               # JSON examples
    ├── some.txt                # Plain text examples
    ├── some.lang               # Lang file examples
    └── extension.test.js       # Tests
```

### Testing
Test files are provided in the `test/` directory:
- `some.json` - JSON with inline TypeScript
- `some.txt` - Plain text with block and inline TypeScript
- `some.lang` - Lang file with block TypeScript

### Building
1. Install dependencies: `npm install`
2. Package extension: `vsce package`

## Requirements

- Visual Studio Code 1.102.0 or higher
- TypeScript language support (built into VS Code)

## Known Issues

- Inline TypeScript patterns must be properly quoted in JSON
- Block syntax requires exact `{ts:` and `:}` delimiters
- Some complex TypeScript syntax may not highlight perfectly within injected contexts

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with the provided examples
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE.txt](LICENSE.txt) file for details.

## Changelog

### 0.0.1
- Initial release
- TypeScript injection for JSON, plain text, and .lang files
- Support for both inline and block syntax patterns
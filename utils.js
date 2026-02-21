export function extractModuleName(code) {
    // Regex : cherche "module", capture le mot suivant, s'arrête avant "where" ou "("
    const match = code.match(/^\s*module\s+([A-Z][A-Za-z0-9_.']*)[\s\w(]*\s+where/m);
    console.log("match is ",{match});
    console.log(match[1]);
    
    if ( match.length > 1 && match[1] !== "") {
        return match[1];
    }
    return "Main"; // Valeur par défaut si non trouvé
}
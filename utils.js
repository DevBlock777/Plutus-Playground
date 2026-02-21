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



/**
 * Envoie des données au format Server-Sent Events avec un type
 * @param {Response} res - L'objet réponse Express
 * @param {string} data - Le contenu à envoyer
 * @param {string} type - 'compilation', 'stdout' ou 'cbor'
 */
export function sendSSE(res, data, type = 'stdout') {
    res.write(`data: ${JSON.stringify({ type: type, output: data })}\n\n`);
}

export function endSSE(res) {
    res.write('event: done\ndata: {}\n\n');
    res.end();
}
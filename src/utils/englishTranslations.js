const EXACT_TRANSLATIONS = new Map([
  ['Controle de Conformite', 'Compliance Control'],
  ['Controle de Gestion', 'Management Control'],
  ['Definition et Declinaison des Orientations Strategiques', 'Definition and Deployment of Strategic Directions'],
  ['Gestion de la Tarification', 'Pricing Management'],
  ['Gestion des Clients', 'Customer Management'],
  ['Gestion des Comptes Clients', 'Customer Account Management'],
  ['Gestion des Engagements', 'Commitment Management'],
  ["Gestion de l'Activite Commerciale et de la Banque a Distance", 'Commercial Activity and Remote Banking Management'],
  ['Gestion de la Communication', 'Communication Management'],
  ['Gestion de la Comptabilite', 'Accounting Management'],
  ['Gestion des Reclamations', 'Complaint Management'],
  ['Gestion des Risques', 'Risk Management'],
  ['Gestion des Ressources Humaines', 'Human Resources Management'],
  ['Gestion des Moyens Generaux', 'General Services Management'],
  ['Gestion de Tresorerie', 'Treasury Management'],
  ['Gestion de la Tresorerie', 'Treasury Management'],
  ['Gestion des Achats', 'Purchasing Management'],
  ['Gestion des Projets', 'Project Management'],
  ['Gestion de la Qualite', 'Quality Management'],
  ['Gestion de la Conformite', 'Compliance Management'],
  ['Gestion du Contentieux', 'Litigation Management'],
  ['Gestion du Recouvrement', 'Collection Management'],
  ['Gestion des Credits', 'Credit Management'],
  ['Gestion du Credit', 'Credit Management'],
  ['Gestion des Cartes', 'Card Management'],
  ['Gestion des Operations', 'Operations Management'],
  ['Gestion des Operations Internationales', 'International Operations Management'],
  ['Ouverture de Compte', 'Account Opening'],
  ['Cloture de Compte', 'Account Closure'],
  ['Tenue de Compte', 'Account Maintenance'],
]);

function stripAccents(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeKey(value = '') {
  return stripAccents(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function translateToEnglish(value = '') {
  const original = String(value || '');
  const normalized = normalizeKey(original);
  if (!normalized) return original;

  const exact = EXACT_TRANSLATIONS.get(normalized);
  if (exact) return exact;

  const genericManagementMatch = normalized.match(/^Gestion (?:de la |de l'|du |des )(.+)$/i);
  if (genericManagementMatch) {
    const subject = genericManagementMatch[1]
      .replace(/\bClients?\b/gi, 'Customers')
      .replace(/\bComptes?\b/gi, 'Accounts')
      .replace(/\bCredits?\b/gi, 'Credit')
      .replace(/\bRisques?\b/gi, 'Risks')
      .replace(/\bReclamations?\b/gi, 'Complaints')
      .replace(/\bTarification\b/gi, 'Pricing')
      .replace(/\bCommunication\b/gi, 'Communication')
      .replace(/\bComptabilite\b/gi, 'Accounting')
      .replace(/\bConformite\b/gi, 'Compliance')
      .replace(/\bActivite Commerciale\b/gi, 'Commercial Activity')
      .replace(/\bBanque a Distance\b/gi, 'Remote Banking');
    return `${titleCase(subject)} Management`;
  }

  return original;
}

export function translateEntityToEnglish(entity) {
  if (!entity || typeof entity !== 'object') return entity;

  return {
    ...entity,
    name: translateToEnglish(entity.name),
    category_name: translateToEnglish(entity.category_name),
    parent_category_name: translateToEnglish(entity.parent_category_name),
    description: translateToEnglish(entity.description),
  };
}

import { PatientData, TranscriptItem } from '@/types';

export type PatientFieldKey =
    | 'name'
    | 'gender'
    | 'age'
    | 'location'
    | 'occupation'
    | 'ration_card_type'
    | 'caste_category'
    | 'housing_type'
    | 'income'
    | 'military_status'
    | 'pregnancy_status'
    | 'scheme_verification';

export interface PatientField {
    key: PatientFieldKey;
    label: string;
    value: string;
}

export interface SchemeCriterionResult {
    id: string;
    fieldKey: PatientFieldKey;
    label: string;
    description: string;
    met: boolean;
}

export interface SchemeDocumentResult {
    id: string;
    name: string;
    available: boolean;
    evidence: string;
}

export interface SchemeEvaluation {
    id: string;
    name: string;
    description: string;
    eligible: boolean;
    eligibilityBand: 'eligible' | 'likely_not_eligible' | 'not_eligible';
    metCriteriaCount: number;
    totalCriteriaCount: number;
    metCriteriaRatio: number;
    availableDocumentCount: number;
    totalDocumentCount: number;
    criteria: SchemeCriterionResult[];
    requiredDocuments: SchemeDocumentResult[];
}

export interface EligibilityWorkspaceData {
    patientFields: PatientField[];
    schemes: SchemeEvaluation[];
}

interface EligibilityContext {
    data: PatientData;
    clinicalText: string;
    location: string;
    age: number | null;
    monthlyIncome: number | null;
    hasIdentity: boolean;
    hasAge: boolean;
    hasGender: boolean;
    hasRationCard: boolean;
    hasIncome: boolean;
    hasOccupation: boolean;
    hasCasteCategory: boolean;
    hasHousingType: boolean;
    hasDiagnosis: boolean;
    hasClinicalSummary: boolean;
    hasVitals: boolean;
    isWoman: boolean;
    isPregnant: boolean;
    isSeniorCitizen: boolean;
    isPriorityRationCard: boolean;
    isScOrSt: boolean;
    isKuchaHousing: boolean;
    isManualLabor: boolean;
    isEsicOccupation: boolean;
    isGovernmentEmployee: boolean;
    isDefenseBeneficiary: boolean;
    isLowIncome: boolean;
    backendPmjayEligible: boolean;
    backendStateEligible: boolean;
}

interface CriterionDefinition {
    id: string;
    fieldKey: PatientFieldKey;
    label: string;
    description: string;
    test: (ctx: EligibilityContext) => boolean;
}

interface DocumentDefinition {
    id: string;
    name: string;
    evidenceWhenPresent: string;
    evidenceWhenMissing: string;
    test: (ctx: EligibilityContext) => boolean;
}

interface SchemeDefinition {
    id: string;
    name: string;
    description: string;
    criteria: CriterionDefinition[];
    requiredDocuments: DocumentDefinition[];
    eligibilityRule: (criteria: SchemeCriterionResult[], ctx: EligibilityContext) => boolean;
}

function text(value: unknown) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    return String(value).trim();
}

function lower(value: unknown) {
    return text(value).toLowerCase();
}

function incomeText(data: PatientData) {
    return text(data.income_bracket || data.income);
}

function isNegativeSignal(value: unknown) {
    const raw = lower(value);
    return ['no', 'none', 'nahi', 'not present', 'nil', 'नहीं', 'नही'].includes(raw);
}

function hasAffirmativeSignal(value: unknown) {
    const raw = lower(value);
    if (!raw) return false;
    if (isNegativeSignal(raw)) return false;
    const compact = raw.replace(/[_-]+/g, ' ');
    return /\b(yes|y|haan|ha|present|available|true|verified|exists)\b/.test(compact);
}

function parseAge(age?: string): number | null {
    const parsed = Number.parseInt(text(age), 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function inferIncome(income?: string): number | null {
    const raw = lower(income);
    if (!raw) return null;

    const numberMatch = raw.match(/(\d+(?:\.\d+)?)/);
    if (!numberMatch) return null;

    let value = Number.parseFloat(numberMatch[1]);
    if (Number.isNaN(value)) return null;

    if (raw.includes('lakh')) value *= 100000;
    else if (raw.includes('crore')) value *= 10000000;
    else if (raw.includes('k')) value *= 1000;

    return Math.round(value);
}

function inferMonthlyIncome(income?: string): number | null {
    const raw = lower(income);
    if (!raw) return null;

    const annual = inferIncome(income);
    if (annual === null) return null;

    if (raw.includes('month') || raw.includes('monthly') || raw.includes('/m')) {
        return annual;
    }
    if (raw.includes('year') || raw.includes('annual') || raw.includes('annum') || raw.includes('/y')) {
        return Math.round(annual / 12);
    }

    // If unspecified and number looks like a monthly wage, treat it as monthly.
    if (annual <= 50000) return annual;
    return Math.round(annual / 12);
}

function locationMatchesState(location: string, keywords: string[]) {
    if (!location) return false;
    return keywords.some((keyword) => location.includes(keyword));
}

function buildClinicalText(data: PatientData, transcript: TranscriptItem[]) {
    const transcriptText = transcript
        .filter((item) => item.type === 'text')
        .map((item) => item.content || '')
        .join(' ');

    return [
        data.chief_complaint,
        data.tentative_doctor_diagnosis,
        data.initial_llm_diagnosis,
        Array.isArray(data.symptoms) ? data.symptoms.join(' ') : '',
        Array.isArray(data.medical_history) ? data.medical_history.join(' ') : '',
        transcriptText,
    ].join(' ').toLowerCase();
}

function buildContext(data: PatientData, transcript: TranscriptItem[]): EligibilityContext {
    const clinicalText = buildClinicalText(data, transcript);
    const location = lower(data.location);
    const age = parseAge(data.age);
    const gender = lower(data.gender);
    const occupation = lower(data.occupation);
    const rationCard = lower(data.ration_card_type);
    const caste = lower(data.caste_category);
    const housing = lower(data.housing_type);
    const income = incomeText(data);
    const incomeLower = lower(income);
    const incomeValue = inferIncome(income);
    const monthlyIncome = inferMonthlyIncome(income);

    const hasDiagnosis = Boolean(text(data.tentative_doctor_diagnosis) || text(data.initial_llm_diagnosis));

    return {
        data,
        clinicalText,
        location,
        age,
        monthlyIncome,
        hasIdentity: Boolean(text(data.name) && text(data.age) && text(data.gender)),
        hasAge: Boolean(text(data.age)),
        hasGender: Boolean(text(data.gender)),
        hasRationCard: Boolean(text(data.ration_card_type)),
        hasIncome: Boolean(income),
        hasOccupation: Boolean(text(data.occupation)),
        hasCasteCategory: Boolean(text(data.caste_category)),
        hasHousingType: Boolean(text(data.housing_type)),
        hasDiagnosis,
        hasClinicalSummary: Boolean(text(data.chief_complaint) || hasDiagnosis || (Array.isArray(data.symptoms) && data.symptoms.length > 0)),
        hasVitals: Boolean(data.vitals?.blood_pressure || data.vitals?.pulse || data.vitals?.temperature || data.vitals?.spo2),
        isWoman: ['female', 'woman', 'f'].some((token) => gender.includes(token)),
        isPregnant: ['pregnan', 'antenatal', 'gestation', 'labour pain', 'delivery'].some((token) => clinicalText.includes(token)),
        isSeniorCitizen: age !== null && age >= 60,
        isPriorityRationCard: (rationCard !== '' && !isNegativeSignal(rationCard)) || ['bpl', 'antyodaya', 'aay', 'yellow', 'phh', 'priority'].some((token) => rationCard.includes(token)) || hasAffirmativeSignal(rationCard),
        isScOrSt: ['sc', 'st', 'scheduled caste', 'scheduled tribe'].some((token) => caste.includes(token)) || hasAffirmativeSignal(caste),
        isKuchaHousing: ['kucha', 'kutcha', 'mud', 'thatch', 'hut', 'temporary', 'कच्चा घर', 'मिट्टी का घर', 'குடிசை', 'கச்சா', 'மண் வீடு'].some((token) => housing.includes(token)) || hasAffirmativeSignal(housing),
        isManualLabor: ['labor', 'labour', 'manual', 'daily wage', 'migrant worker'].some((token) => occupation.includes(token)) || hasAffirmativeSignal(occupation),
        isEsicOccupation: ['employee', 'worker', 'factory', 'industrial', 'staff', 'salaried', 'private job'].some((token) => occupation.includes(token)),
        isGovernmentEmployee: ['government', 'govt', 'central service', 'state service', 'pensioner'].some((token) => occupation.includes(token)),
        isDefenseBeneficiary: ['veteran', 'ex-serviceman', 'defence', 'defense', 'army', 'navy', 'air force'].some((token) => occupation.includes(token)),
        isLowIncome: incomeValue !== null ? incomeValue <= 200000 : ['below', 'under', 'low income', 'less than'].some((token) => incomeLower.includes(token)),
        backendPmjayEligible: Boolean(data.scheme_eligibility?.pmjay?.eligible),
        backendStateEligible: Boolean(data.scheme_eligibility?.state_scheme?.eligible),
    };
}

function evaluateScheme(definition: SchemeDefinition, ctx: EligibilityContext): SchemeEvaluation {
    const criteria = definition.criteria.map((criterion) => ({
        id: criterion.id,
        fieldKey: criterion.fieldKey,
        label: criterion.label,
        description: criterion.description,
        met: criterion.test(ctx),
    }));

    const requiredDocuments = definition.requiredDocuments.map((doc) => {
        const available = doc.test(ctx);
        return {
            id: doc.id,
            name: doc.name,
            available,
            evidence: available ? doc.evidenceWhenPresent : doc.evidenceWhenMissing,
        };
    });

    const eligible = definition.eligibilityRule(criteria, ctx);
    const metCriteriaCount = criteria.filter((item) => item.met).length;
    const totalCriteriaCount = criteria.length;
    const metCriteriaRatio = totalCriteriaCount > 0 ? metCriteriaCount / totalCriteriaCount : 0;

    // Logic for tighter bands: 
    // Even if 'eligible' is true, if it's based on very few criteria (e.g. 1/5), show as 'likely_not_eligible' (Possible) 
    // unless it's a backend verification match.
    let eligibilityBand: SchemeEvaluation['eligibilityBand'] = 'not_eligible';

    if (eligible) {
        if (metCriteriaCount >= 2 || ctx.backendPmjayEligible) {
            eligibilityBand = 'eligible';
        } else {
            eligibilityBand = 'likely_not_eligible'; // Show as "Possibly eligible"
        }
    } else if (metCriteriaRatio >= 0.5) {
        eligibilityBand = 'likely_not_eligible';
    }

    return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        eligible,
        eligibilityBand,
        metCriteriaCount,
        totalCriteriaCount,
        metCriteriaRatio,
        availableDocumentCount: requiredDocuments.filter((doc) => doc.available).length,
        totalDocumentCount: requiredDocuments.length,
        criteria,
        requiredDocuments,
    };
}

const SCHEME_DEFINITIONS: SchemeDefinition[] = [
    {
        id: 'pmjay',
        name: 'Ayushman Bharat PM-JAY',
        description: 'Rural deprivation and vulnerable household based public coverage.',
        criteria: [
            {
                id: 'pmjay-ration',
                fieldKey: 'ration_card_type',
                label: 'Ration/deprivation marker is present.',
                description: 'Any explicit yes/present marker is treated as preliminary support; exact card category is verified at filing.',
                test: (ctx) => ctx.isPriorityRationCard,
            },
            {
                id: 'pmjay-caste',
                fieldKey: 'caste_category',
                label: 'SC/ST category marker captured.',
                description: 'SC/ST deprivation marker supports PM-JAY eligibility review.',
                test: (ctx) => ctx.isScOrSt,
            },
            {
                id: 'pmjay-labor',
                fieldKey: 'occupation',
                label: 'Occupation indicates manual labour vulnerability.',
                description: 'Casual/manual labour households are considered under deprivation logic.',
                test: (ctx) => ctx.isManualLabor,
            },
            {
                id: 'pmjay-housing',
                fieldKey: 'housing_type',
                label: 'Housing type indicates kutcha/kucha dwelling.',
                description: 'Kutcha housing is a common deprivation proxy.',
                test: (ctx) => ctx.isKuchaHousing,
            },
            {
                id: 'pmjay-backend',
                fieldKey: 'scheme_verification',
                label: 'Backend PM-JAY verification is positive.',
                description: 'Realtime PM-JAY check from the scribe stream is marked eligible.',
                test: (ctx) => ctx.backendPmjayEligible,
            },
        ],
        requiredDocuments: [
            {
                id: 'pmjay-identity',
                name: 'Identity proof (name, age, gender)',
                evidenceWhenPresent: 'Identity fields are complete in patient biodata.',
                evidenceWhenMissing: 'Name, age, and gender must all be present.',
                test: (ctx) => ctx.hasIdentity,
            },
            {
                id: 'pmjay-rationproof',
                name: 'Ration/deprivation proof',
                evidenceWhenPresent: 'Ration/deprivation indicator exists in patient profile.',
                evidenceWhenMissing: 'Ration/deprivation evidence is not available yet.',
                test: (ctx) => ctx.hasRationCard || ctx.isScOrSt || ctx.isKuchaHousing || ctx.isManualLabor,
            },
            {
                id: 'pmjay-verification',
                name: 'PM-JAY verification response',
                evidenceWhenPresent: 'Backend PM-JAY verification is available.',
                evidenceWhenMissing: 'No positive PM-JAY backend verification found.',
                test: (ctx) => ctx.backendPmjayEligible,
            },
            {
                id: 'pmjay-clinical',
                name: 'Clinical consultation summary',
                evidenceWhenPresent: 'Chief complaint/symptoms/diagnosis are captured.',
                evidenceWhenMissing: 'Clinical summary is incomplete.',
                test: (ctx) => ctx.hasClinicalSummary,
            },
        ],
        eligibilityRule: (criteria, ctx) => {
            const deprivationMarkersMet = criteria.filter(c => c.met && c.id !== 'pmjay-backend').length;
            // PM-JAY is eligible if backend says yes OR if at least 1 strong deprivation marker is met
            return ctx.backendPmjayEligible || deprivationMarkersMet >= 1;
        },
    },
    {
        id: 'esic',
        name: "Employees' State Insurance (ESIC)",
        description: 'Contributory insurance for eligible workers under the ESI Act wage criteria.',
        criteria: [
            {
                id: 'esic-occupation',
                fieldKey: 'occupation',
                label: 'Occupation indicates worker/employee profile.',
                description: 'ESIC generally applies to insured workers in covered employment.',
                test: (ctx) => ctx.isEsicOccupation || ctx.isManualLabor,
            },
            {
                id: 'esic-income',
                fieldKey: 'income',
                label: 'Monthly wage appears within ESI threshold (~₹21,000).',
                description: 'Screening uses captured income text; final wage validation happens at enrollment.',
                test: (ctx) => ctx.monthlyIncome !== null && ctx.monthlyIncome <= 21000,
            },
            {
                id: 'esic-age',
                fieldKey: 'age',
                label: 'Age is recorded for insurance enrollment.',
                description: 'Age capture is required for beneficiary records.',
                test: (ctx) => ctx.hasAge,
            },
        ],
        requiredDocuments: [
            {
                id: 'esic-ip',
                name: 'ESIC insurance number / Pehchan details',
                evidenceWhenPresent: 'Tick after ESIC card/IP number is verified.',
                evidenceWhenMissing: 'Tick after ESIC card/IP number is verified.',
                test: () => false,
            },
            {
                id: 'esic-employer',
                name: 'Employer certificate / employment proof',
                evidenceWhenPresent: 'Tick after employer proof is uploaded.',
                evidenceWhenMissing: 'Tick after employer proof is uploaded.',
                test: () => false,
            },
            {
                id: 'esic-wage',
                name: 'Recent wage slip or wage declaration',
                evidenceWhenPresent: 'Tick after wage proof is uploaded.',
                evidenceWhenMissing: 'Tick after wage proof is uploaded.',
                test: () => false,
            },
            {
                id: 'esic-id',
                name: 'Identity proof (Aadhaar/ID)',
                evidenceWhenPresent: 'Tick after identity proof is uploaded.',
                evidenceWhenMissing: 'Tick after identity proof is uploaded.',
                test: () => false,
            },
        ],
        eligibilityRule: (criteria) =>
            (criteria.find((item) => item.id === 'esic-occupation')?.met ?? false)
            && (criteria.find((item) => item.id === 'esic-income')?.met ?? false),
    },
    {
        id: 'mjpjay',
        name: 'Mahatma Jyotiba Phule Jan Arogya Yojana (MJPJAY)',
        description: 'Maharashtra public health assurance scheme for eligible vulnerable households.',
        criteria: [
            {
                id: 'mjpjay-ration',
                fieldKey: 'ration_card_type',
                label: 'Ration/deprivation marker is present.',
                description: 'Screening uses yes/priority ration indicators.',
                test: (ctx) => ctx.isPriorityRationCard || ctx.hasRationCard,
            },
            {
                id: 'mjpjay-income',
                fieldKey: 'income',
                label: 'Income appears within low-income coverage range.',
                description: 'Income capture supports preliminary scheme fit.',
                test: (ctx) => ctx.isLowIncome,
            },
            {
                id: 'mjpjay-vulnerability',
                fieldKey: 'occupation',
                label: 'Occupation/housing reflects vulnerability marker.',
                description: 'Manual labour or kutcha housing improves screening confidence.',
                test: (ctx) => ctx.isManualLabor || ctx.isKuchaHousing,
            },
            {
                id: 'mjpjay-location',
                fieldKey: 'location',
                label: 'Residence location indicates Maharashtra.',
                description: 'State-specific scheme; out-of-state residence is treated as not eligible.',
                test: (ctx) => locationMatchesState(ctx.location, ['maharashtra', 'mh']),
            },
        ],
        requiredDocuments: [
            {
                id: 'mjpjay-ration-card',
                name: 'Eligible ration card / family card',
                evidenceWhenPresent: 'Tick after eligible ration/family card copy is uploaded.',
                evidenceWhenMissing: 'Tick after eligible ration/family card copy is uploaded.',
                test: () => false,
            },
            {
                id: 'mjpjay-residence',
                name: 'State residence proof',
                evidenceWhenPresent: 'Tick after state residence proof is uploaded.',
                evidenceWhenMissing: 'Tick after state residence proof is uploaded.',
                test: () => false,
            },
            {
                id: 'mjpjay-id',
                name: 'Identity proof',
                evidenceWhenPresent: 'Tick after identity proof is uploaded.',
                evidenceWhenMissing: 'Tick after identity proof is uploaded.',
                test: () => false,
            },
            {
                id: 'mjpjay-clinical',
                name: 'Treating doctor advice/discharge summary',
                evidenceWhenPresent: 'Tick after clinical documents are uploaded.',
                evidenceWhenMissing: 'Tick after clinical documents are uploaded.',
                test: () => false,
            },
        ],
        eligibilityRule: (criteria) =>
            (criteria.find((item) => item.id === 'mjpjay-location')?.met ?? false)
            && criteria.filter((item) => item.met && item.id !== 'mjpjay-location').length >= 2,
    },
    {
        id: 'aarogyasri',
        name: 'Aarogyasri Health Care Trust Scheme',
        description: 'State tertiary-care coverage model for low-income families (Aarogyasri model).',
        criteria: [
            {
                id: 'aarogyasri-ration',
                fieldKey: 'ration_card_type',
                label: 'Ration/BPL-style marker is present.',
                description: 'Aarogyasri screening commonly uses ration/economic markers.',
                test: (ctx) => ctx.isPriorityRationCard || ctx.hasRationCard,
            },
            {
                id: 'aarogyasri-income',
                fieldKey: 'income',
                label: 'Income appears within low-income range.',
                description: 'Low-income capture supports eligibility screening.',
                test: (ctx) => ctx.isLowIncome,
            },
            {
                id: 'aarogyasri-identity',
                fieldKey: 'name',
                label: 'Patient identity fields are captured.',
                description: 'Identity completeness required for package processing.',
                test: (ctx) => ctx.hasIdentity,
            },
            {
                id: 'aarogyasri-location',
                fieldKey: 'location',
                label: 'Residence location indicates Telangana/Andhra Pradesh.',
                description: 'State-specific scheme; out-of-state residence is treated as not eligible.',
                test: (ctx) => locationMatchesState(ctx.location, ['telangana', 'tg', 'andhra', 'andhra pradesh', 'ap']),
            },
        ],
        requiredDocuments: [
            {
                id: 'aarogyasri-ration',
                name: 'Ration/BPL card proof',
                evidenceWhenPresent: 'Tick after ration/BPL proof is uploaded.',
                evidenceWhenMissing: 'Tick after ration/BPL proof is uploaded.',
                test: () => false,
            },
            {
                id: 'aarogyasri-residence',
                name: 'State residence proof',
                evidenceWhenPresent: 'Tick after residence proof is uploaded.',
                evidenceWhenMissing: 'Tick after residence proof is uploaded.',
                test: () => false,
            },
            {
                id: 'aarogyasri-id',
                name: 'Aadhaar/identity proof',
                evidenceWhenPresent: 'Tick after identity proof is uploaded.',
                evidenceWhenMissing: 'Tick after identity proof is uploaded.',
                test: () => false,
            },
            {
                id: 'aarogyasri-clinical',
                name: 'Clinical summary and investigation reports',
                evidenceWhenPresent: 'Tick after clinical reports are uploaded.',
                evidenceWhenMissing: 'Tick after clinical reports are uploaded.',
                test: () => false,
            },
        ],
        eligibilityRule: (criteria) =>
            (criteria.find((item) => item.id === 'aarogyasri-location')?.met ?? false)
            && criteria.filter((item) => item.met && item.id !== 'aarogyasri-location').length >= 2,
    },
    {
        id: 'cmchis',
        name: "Chief Minister's Comprehensive Health Insurance Scheme (CMCHIS)",
        description: 'Tamil Nadu public insurance scheme for eligible income-card based households.',
        criteria: [
            {
                id: 'cmchis-income',
                fieldKey: 'income',
                label: 'Income appears within public coverage range.',
                description: 'CMCHIS screening considers household income limits.',
                test: (ctx) => ctx.isLowIncome,
            },
            {
                id: 'cmchis-ration',
                fieldKey: 'ration_card_type',
                label: 'Ration/family card indicator is captured.',
                description: 'Family/ration card capture supports preliminary fit.',
                test: (ctx) => ctx.hasRationCard || ctx.isPriorityRationCard,
            },
            {
                id: 'cmchis-identity',
                fieldKey: 'name',
                label: 'Identity fields are complete.',
                description: 'Identity completeness is needed for claim packet creation.',
                test: (ctx) => ctx.hasIdentity,
            },
            {
                id: 'cmchis-location',
                fieldKey: 'location',
                label: 'Residence location indicates Tamil Nadu.',
                description: 'State-specific scheme; out-of-state residence is treated as not eligible.',
                test: (ctx) => locationMatchesState(ctx.location, ['tamil nadu', 'tn']),
            },
        ],
        requiredDocuments: [
            {
                id: 'cmchis-income-proof',
                name: 'Income certificate',
                evidenceWhenPresent: 'Tick after income certificate is uploaded.',
                evidenceWhenMissing: 'Tick after income certificate is uploaded.',
                test: () => false,
            },
            {
                id: 'cmchis-family-card',
                name: 'Family/ration card',
                evidenceWhenPresent: 'Tick after family/ration card is uploaded.',
                evidenceWhenMissing: 'Tick after family/ration card is uploaded.',
                test: () => false,
            },
            {
                id: 'cmchis-id',
                name: 'Identity proof',
                evidenceWhenPresent: 'Tick after identity proof is uploaded.',
                evidenceWhenMissing: 'Tick after identity proof is uploaded.',
                test: () => false,
            },
            {
                id: 'cmchis-clinical',
                name: 'Procedure recommendation and clinical record',
                evidenceWhenPresent: 'Tick after clinical recommendation is uploaded.',
                evidenceWhenMissing: 'Tick after clinical recommendation is uploaded.',
                test: () => false,
            },
        ],
        eligibilityRule: (criteria) =>
            (criteria.find((item) => item.id === 'cmchis-location')?.met ?? false)
            && criteria.filter((item) => item.met && item.id !== 'cmchis-location').length >= 2,
    },
    {
        id: 'kasp',
        name: 'Karunya Arogya Suraksha Padhathi (KASP)',
        description: 'Kerala assurance scheme aligned to PM-JAY style coverage for eligible families.',
        criteria: [
            {
                id: 'kasp-ration',
                fieldKey: 'ration_card_type',
                label: 'Ration/NFSA-style marker is captured.',
                description: 'Ration status is a key screening signal.',
                test: (ctx) => ctx.hasRationCard || ctx.isPriorityRationCard,
            },
            {
                id: 'kasp-income',
                fieldKey: 'income',
                label: 'Income indicates financially vulnerable household.',
                description: 'Low-income household marker supports KASP screening.',
                test: (ctx) => ctx.isLowIncome,
            },
            {
                id: 'kasp-vulnerability',
                fieldKey: 'caste_category',
                label: 'Vulnerability proxy (SC/ST/manual labour/housing) is present.',
                description: 'Multiple vulnerability indicators improve eligibility confidence.',
                test: (ctx) => ctx.isScOrSt || ctx.isManualLabor || ctx.isKuchaHousing,
            },
            {
                id: 'kasp-location',
                fieldKey: 'location',
                label: 'Residence location indicates Kerala.',
                description: 'State-specific scheme; out-of-state residence is treated as not eligible.',
                test: (ctx) => locationMatchesState(ctx.location, ['kerala', 'kl']),
            },
        ],
        requiredDocuments: [
            {
                id: 'kasp-ration',
                name: 'Ration/NFSA card',
                evidenceWhenPresent: 'Tick after ration/NFSA card is uploaded.',
                evidenceWhenMissing: 'Tick after ration/NFSA card is uploaded.',
                test: () => false,
            },
            {
                id: 'kasp-id',
                name: 'Aadhaar/identity proof',
                evidenceWhenPresent: 'Tick after identity proof is uploaded.',
                evidenceWhenMissing: 'Tick after identity proof is uploaded.',
                test: () => false,
            },
            {
                id: 'kasp-residence',
                name: 'State residence proof',
                evidenceWhenPresent: 'Tick after residence proof is uploaded.',
                evidenceWhenMissing: 'Tick after residence proof is uploaded.',
                test: () => false,
            },
            {
                id: 'kasp-clinical',
                name: 'Clinical package recommendation',
                evidenceWhenPresent: 'Tick after package recommendation is uploaded.',
                evidenceWhenMissing: 'Tick after package recommendation is uploaded.',
                test: () => false,
            },
        ],
        eligibilityRule: (criteria) =>
            (criteria.find((item) => item.id === 'kasp-location')?.met ?? false)
            && criteria.filter((item) => item.met && item.id !== 'kasp-location').length >= 2,
    },
    {
        id: 'bsky',
        name: 'Biju Swasthya Kalyan Yojana (BSKY)',
        description: 'Odisha health assurance scheme for eligible households, commonly linked to NFSA/SFSS lists.',
        criteria: [
            {
                id: 'bsky-ration',
                fieldKey: 'ration_card_type',
                label: 'Ration/smart-card style marker is present.',
                description: 'NFSA/SFSS-style beneficiary identification often uses card-based records.',
                test: (ctx) => ctx.hasRationCard || ctx.isPriorityRationCard,
            },
            {
                id: 'bsky-income',
                fieldKey: 'income',
                label: 'Income indicates vulnerable household.',
                description: 'Income marker is used as preliminary screening signal.',
                test: (ctx) => ctx.isLowIncome,
            },
            {
                id: 'bsky-identity',
                fieldKey: 'name',
                label: 'Identity fields are captured.',
                description: 'Identity completeness required for claim packet.',
                test: (ctx) => ctx.hasIdentity,
            },
            {
                id: 'bsky-location',
                fieldKey: 'location',
                label: 'Residence location indicates Odisha.',
                description: 'State-specific scheme; out-of-state residence is treated as not eligible.',
                test: (ctx) => locationMatchesState(ctx.location, ['odisha', 'orissa', 'od']),
            },
        ],
        requiredDocuments: [
            {
                id: 'bsky-card',
                name: 'BSKY/NFSA/SFSS beneficiary card proof',
                evidenceWhenPresent: 'Tick after beneficiary card proof is uploaded.',
                evidenceWhenMissing: 'Tick after beneficiary card proof is uploaded.',
                test: () => false,
            },
            {
                id: 'bsky-id',
                name: 'Identity proof',
                evidenceWhenPresent: 'Tick after identity proof is uploaded.',
                evidenceWhenMissing: 'Tick after identity proof is uploaded.',
                test: () => false,
            },
            {
                id: 'bsky-residence',
                name: 'State residence proof',
                evidenceWhenPresent: 'Tick after residence proof is uploaded.',
                evidenceWhenMissing: 'Tick after residence proof is uploaded.',
                test: () => false,
            },
            {
                id: 'bsky-clinical',
                name: 'Clinical summary and discharge/investigation papers',
                evidenceWhenPresent: 'Tick after clinical papers are uploaded.',
                evidenceWhenMissing: 'Tick after clinical papers are uploaded.',
                test: () => false,
            },
        ],
        eligibilityRule: (criteria) =>
            (criteria.find((item) => item.id === 'bsky-location')?.met ?? false)
            && criteria.filter((item) => item.met && item.id !== 'bsky-location').length >= 2,
    },
    {
        id: 'rghs',
        name: 'Rajasthan Government Health Scheme (RGHS)',
        description: 'Cashless model for eligible state government employees and pensioners.',
        criteria: [
            {
                id: 'rghs-occupation',
                fieldKey: 'occupation',
                label: 'Occupation indicates government employee/pensioner.',
                description: 'RGHS beneficiary categories include government service and pensioners.',
                test: (ctx) => ctx.isGovernmentEmployee,
            },
            {
                id: 'rghs-age',
                fieldKey: 'age',
                label: 'Age is captured.',
                description: 'Age capture needed for registration packet.',
                test: (ctx) => ctx.hasAge,
            },
            {
                id: 'rghs-location',
                fieldKey: 'location',
                label: 'Residence location indicates Rajasthan.',
                description: 'State-specific scheme; out-of-state residence is treated as not eligible.',
                test: (ctx) => locationMatchesState(ctx.location, ['rajasthan', 'rj']),
            },
        ],
        requiredDocuments: [
            {
                id: 'rghs-card',
                name: 'RGHS card / employee ID',
                evidenceWhenPresent: 'Tick after RGHS card/employee ID is uploaded.',
                evidenceWhenMissing: 'Tick after RGHS card/employee ID is uploaded.',
                test: () => false,
            },
            {
                id: 'rghs-service',
                name: 'Service certificate / pension PPO',
                evidenceWhenPresent: 'Tick after service or PPO proof is uploaded.',
                evidenceWhenMissing: 'Tick after service or PPO proof is uploaded.',
                test: () => false,
            },
            {
                id: 'rghs-id',
                name: 'Identity proof',
                evidenceWhenPresent: 'Tick after identity proof is uploaded.',
                evidenceWhenMissing: 'Tick after identity proof is uploaded.',
                test: () => false,
            },
            {
                id: 'rghs-clinical',
                name: 'Clinical consultation summary',
                evidenceWhenPresent: 'Tick after clinical summary is uploaded.',
                evidenceWhenMissing: 'Tick after clinical summary is uploaded.',
                test: () => false,
            },
        ],
        eligibilityRule: (criteria) =>
            (criteria.find((item) => item.id === 'rghs-occupation')?.met ?? false)
            && (criteria.find((item) => item.id === 'rghs-location')?.met ?? false),
    },
    {
        id: 'cghs',
        name: 'CGHS',
        description: 'Central Government Health Scheme for govt employees/pensioners.',
        criteria: [
            {
                id: 'cghs-occupation',
                fieldKey: 'occupation',
                label: 'Occupation indicates government service/pensioner.',
                description: 'CGHS is linked to central/state government service entitlements.',
                test: (ctx) => ctx.isGovernmentEmployee,
            },
            {
                id: 'cghs-gender',
                fieldKey: 'gender',
                label: 'Gender value is recorded.',
                description: 'Demographic completeness required for scheme packet.',
                test: (ctx) => ctx.hasGender,
            },
        ],
        requiredDocuments: [
            {
                id: 'cghs-identity',
                name: 'Identity proof (name, age, gender)',
                evidenceWhenPresent: 'Identity fields are complete in patient biodata.',
                evidenceWhenMissing: 'Name, age, and gender must all be present.',
                test: (ctx) => ctx.hasIdentity,
            },
            {
                id: 'cghs-beneficiary',
                name: 'CGHS beneficiary/service proof',
                evidenceWhenPresent: 'Occupation suggests government service eligibility.',
                evidenceWhenMissing: 'Government service/pension marker not found.',
                test: (ctx) => ctx.isGovernmentEmployee,
            },
            {
                id: 'cghs-clinical',
                name: 'Clinical consultation summary',
                evidenceWhenPresent: 'Clinical summary is available.',
                evidenceWhenMissing: 'Clinical summary is incomplete.',
                test: (ctx) => ctx.hasClinicalSummary,
            },
            {
                id: 'cghs-diagnosis',
                name: 'Treating doctor diagnosis note',
                evidenceWhenPresent: 'Diagnosis/impression is available.',
                evidenceWhenMissing: 'Diagnosis/impression is missing.',
                test: (ctx) => ctx.hasDiagnosis,
            },
            {
                id: 'cghs-vitals',
                name: 'Vitals/investigation sheet',
                evidenceWhenPresent: 'Vitals/investigation values are present.',
                evidenceWhenMissing: 'Vitals/investigation data is missing.',
                test: (ctx) => ctx.hasVitals,
            },
        ],
        eligibilityRule: (criteria) => criteria.find((item) => item.id === 'cghs-occupation')?.met ?? false,
    },
    {
        id: 'echs',
        name: 'ECHS',
        description: 'Ex-Servicemen Contributory Health Scheme for defense beneficiaries.',
        criteria: [
            {
                id: 'echs-defense',
                fieldKey: 'military_status',
                label: 'Military/veteran beneficiary marker is present.',
                description: 'ECHS requires defense/veteran beneficiary status.',
                test: (ctx) => ctx.isDefenseBeneficiary,
            },
            {
                id: 'echs-age',
                fieldKey: 'age',
                label: 'Age value is recorded.',
                description: 'Demographic completeness required for ECHS form.',
                test: (ctx) => ctx.hasAge,
            },
        ],
        requiredDocuments: [
            {
                id: 'echs-identity',
                name: 'Identity proof (name, age, gender)',
                evidenceWhenPresent: 'Identity fields are complete in patient biodata.',
                evidenceWhenMissing: 'Name, age, and gender must all be present.',
                test: (ctx) => ctx.hasIdentity,
            },
            {
                id: 'echs-beneficiary',
                name: 'ECHS card / veteran service proof',
                evidenceWhenPresent: 'Military/veteran marker is available from occupation.',
                evidenceWhenMissing: 'Military/veteran marker is missing.',
                test: (ctx) => ctx.isDefenseBeneficiary,
            },
            {
                id: 'echs-clinical',
                name: 'Clinical consultation summary',
                evidenceWhenPresent: 'Clinical summary is available.',
                evidenceWhenMissing: 'Clinical summary is incomplete.',
                test: (ctx) => ctx.hasClinicalSummary,
            },
            {
                id: 'echs-diagnosis',
                name: 'Treating doctor diagnosis note',
                evidenceWhenPresent: 'Diagnosis/impression is available.',
                evidenceWhenMissing: 'Diagnosis/impression is missing.',
                test: (ctx) => ctx.hasDiagnosis,
            },
            {
                id: 'echs-vitals',
                name: 'Vitals/investigation sheet',
                evidenceWhenPresent: 'Vitals/investigation values are present.',
                evidenceWhenMissing: 'Vitals/investigation data is missing.',
                test: (ctx) => ctx.hasVitals,
            },
        ],
        eligibilityRule: (criteria) => criteria.find((item) => item.id === 'echs-defense')?.met ?? false,
    },
];

export function buildEligibilityWorkspace(data: PatientData, transcript: TranscriptItem[]): EligibilityWorkspaceData {
    const context = buildContext(data, transcript);

    const patientFields: PatientField[] = [
        { key: 'name', label: 'Name', value: text(data.name) || 'Not captured' },
        { key: 'gender', label: 'Gender', value: text(data.gender) || 'Not captured' },
        { key: 'age', label: 'Age', value: text(data.age) || 'Not captured' },
        { key: 'location', label: 'Location', value: text(data.location) || 'Not captured' },
        { key: 'occupation', label: 'Occupation', value: text(data.occupation) || 'Not captured' },
        { key: 'ration_card_type', label: 'Ration card type', value: text(data.ration_card_type) || 'Not captured' },
        { key: 'income', label: 'Income', value: incomeText(data) || 'Not captured' },
        { key: 'caste_category', label: 'Caste category', value: text(data.caste_category) || 'Not captured' },
        { key: 'housing_type', label: 'Housing type', value: text(data.housing_type) || 'Not captured' },
        { key: 'military_status', label: 'Military/veteran status', value: context.isDefenseBeneficiary ? 'Yes' : 'No' },
        { key: 'pregnancy_status', label: 'Pregnancy marker', value: context.isPregnant ? 'Present in consultation' : 'Not present' },
        { key: 'scheme_verification', label: 'Backend scheme verification', value: context.backendPmjayEligible || context.backendStateEligible ? 'Available' : 'Not available' },
    ];

    const schemes = SCHEME_DEFINITIONS
        .map((scheme) => evaluateScheme(scheme, context))
        .sort((a, b) => {
            const rank = (band: SchemeEvaluation['eligibilityBand']) => {
                if (band === 'eligible') return 0;
                if (band === 'likely_not_eligible') return 1;
                return 2;
            };

            const rankDiff = rank(a.eligibilityBand) - rank(b.eligibilityBand);
            if (rankDiff !== 0) return rankDiff;
            if (a.metCriteriaRatio !== b.metCriteriaRatio) return b.metCriteriaRatio - a.metCriteriaRatio;
            if (a.metCriteriaCount !== b.metCriteriaCount) return b.metCriteriaCount - a.metCriteriaCount;
            return a.name.localeCompare(b.name);
        });

    return { patientFields, schemes };
}

export type FieldMatchStatus = 'match' | 'mismatch' | 'neutral';

export function getFieldMatchStatus(fieldKey: PatientFieldKey, scheme: SchemeEvaluation | null): FieldMatchStatus {
    if (!scheme) return 'neutral';

    const relatedCriteria = scheme.criteria.filter((criterion) => criterion.fieldKey === fieldKey);
    if (relatedCriteria.length === 0) return 'neutral';

    return relatedCriteria.every((criterion) => criterion.met) ? 'match' : 'mismatch';
}

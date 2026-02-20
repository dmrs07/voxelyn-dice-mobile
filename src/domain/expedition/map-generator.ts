import { SeededRng } from '../../core/rng';
import type { ExpeditionMap, GameContent, MapNode, NodeType } from '../shared/types';

const makeNodeLabel = (type: NodeType, depth: number): { title: string; subtitle: string } => {
  switch (type) {
    case 'start':
      return { title: 'Acampamento Base', subtitle: 'Organize a trip antes de partir.' };
    case 'event':
      return { title: `Evento ${depth}`, subtitle: 'Decisao narrativa com teste por dados.' };
    case 'combat':
      return { title: `Conflito ${depth}`, subtitle: 'Encontro hostil no caminho.' };
    case 'shop':
      return { title: 'Mercado Itinerante', subtitle: 'Troque ouro e recursos por vantagem.' };
    case 'rest':
      return { title: 'Acampamento Seguro', subtitle: 'Recupere a trip e reduza risco.' };
    case 'elite':
      return { title: 'Patrulha de Elite', subtitle: 'Inimigos fortes, premio melhor.' };
    case 'boss':
      return { title: 'Capitao Vesper', subtitle: 'Confronto final do bioma.' };
    default:
      return { title: `No ${depth}`, subtitle: '' };
  }
};

const chooseNodeTypes = (rng: SeededRng, totalNodes: number): NodeType[] => {
  const types: NodeType[] = ['start'];
  const middleCount = totalNodes - 2;
  const fixed: NodeType[] = ['shop', 'rest', 'elite'];
  const tacticalSlots = Math.max(2, middleCount - fixed.length);

  let eventCount = Math.round(tacticalSlots * 0.55);
  eventCount = Math.max(2, Math.min(tacticalSlots - 1, eventCount));
  const combatCount = Math.max(1, tacticalSlots - eventCount);

  const middle = rng.shuffle([
    ...fixed,
    ...new Array(eventCount).fill('event'),
    ...new Array(combatCount).fill('combat'),
  ] as NodeType[]).slice(0, middleCount);

  const eliteIndex = middle.findIndex((entry) => entry === 'elite');
  if (eliteIndex >= 0) {
    const desired = Math.max(2, middleCount - 2);
    const swap = middle[desired] as NodeType;
    middle[desired] = 'elite';
    middle[eliteIndex] = swap;
  }

  types.push(...middle);
  types.push('boss');

  return types;
};

const chooseEncounterIds = (
  type: NodeType,
  rng: SeededRng,
  content: GameContent,
): string[] => {
  const bossIds = content.enemies.filter((entry) => entry.isBoss).map((entry) => entry.id);
  const regularIds = content.enemies
    .filter((entry) => !entry.isBoss && !entry.tags.includes('summon_only'))
    .map((entry) => entry.id);

  if (type === 'boss') {
    return [bossIds[0] ?? regularIds[0] ?? ''];
  }

  if (type === 'elite') {
    const first = regularIds[rng.nextInt(regularIds.length)] as string;
    const second = regularIds[rng.nextInt(regularIds.length)] as string;
    return [first, second].filter(Boolean);
  }

  if (type === 'combat') {
    const count = rng.rangeInt(1, 2);
    return rng.shuffle(regularIds).slice(0, count);
  }

  return [];
};

export const generateExpeditionMap = (seed: number, content: GameContent): ExpeditionMap => {
  const rng = new SeededRng(seed);
  const totalNodes = rng.rangeInt(12, 15);
  const types = chooseNodeTypes(rng, totalNodes);

  const orderedNodeIds = types.map((_, index) => `node_${index}`);
  const nodes: Record<string, MapNode> = {};

  for (let index = 0; index < types.length; index += 1) {
    const nodeId = orderedNodeIds[index] as string;
    const type = types[index] as NodeType;
    const next = index + 1 < orderedNodeIds.length ? [orderedNodeIds[index + 1] as string] : [];
    const label = makeNodeLabel(type, index);

    nodes[nodeId] = {
      id: nodeId,
      type,
      depth: index,
      next,
      title: label.title,
      subtitle: label.subtitle,
      encounterIds: chooseEncounterIds(type, rng, content),
      visited: false,
      revealed: index <= 1,
    };
  }

  if (orderedNodeIds.length >= 10) {
    const forkIndex = rng.rangeInt(2, 4);
    const nodeId = orderedNodeIds[forkIndex] as string;
    const optionA = orderedNodeIds[forkIndex + 1] as string;
    const optionB = orderedNodeIds[forkIndex + 2] as string;
    const mergeTo = orderedNodeIds[forkIndex + 3] as string;

    nodes[nodeId].next = [optionA, optionB];
    nodes[optionA].next = [mergeTo];
    nodes[optionB].next = [mergeTo];
  }

  const startNodeId = orderedNodeIds[0] as string;
  const bossNodeId = orderedNodeIds[orderedNodeIds.length - 1] as string;

  return {
    id: `map_${seed}`,
    biomeId: content.biome.id,
    nodes,
    orderedNodeIds,
    startNodeId,
    bossNodeId,
  };
};

import { TileType } from "../../utils/dungeonGenerator";

export interface Point {
  x: number;
  y: number;
}

interface Node {
  x: number;
  y: number;
  g: number; // Cost from start
  h: number; // Heuristic cost to goal
  f: number; // Total cost (g + h)
  parent: Node | null;
}

/**
 * A* Pathfinding implementation for dungeon navigation
 */
export class Pathfinding {
  /**
   * Find shortest path from start to goal using A* algorithm
   * @param grid Dungeon grid (0=wall, 1=floor, etc.)
   * @param start Starting position
   * @param goal Goal position
   * @returns Array of points representing the path, or empty array if no path exists
   */
  static findPath(grid: number[][], start: Point, goal: Point): Point[] {
    if (!grid || grid.length === 0) return [];

    const height = grid.length;
    const width = grid[0].length;

    // Validate start and goal
    if (!this.isWalkable(grid, start.x, start.y) || !this.isWalkable(grid, goal.x, goal.y)) {
      return [];
    }

    const openList: Node[] = [];
    const closedSet = new Set<string>();

    // Create start node
    const startNode: Node = {
      x: start.x,
      y: start.y,
      g: 0,
      h: this.heuristic(start.x, start.y, goal.x, goal.y),
      f: 0,
      parent: null,
    };
    startNode.f = startNode.g + startNode.h;
    openList.push(startNode);

    while (openList.length > 0) {
      // Find node with lowest f cost
      let currentIndex = 0;
      for (let i = 1; i < openList.length; i++) {
        if (openList[i].f < openList[currentIndex].f) {
          currentIndex = i;
        }
      }

      const current = openList[currentIndex];

      // Check if we reached the goal
      if (current.x === goal.x && current.y === goal.y) {
        return this.reconstructPath(current);
      }

      // Move current from open to closed
      openList.splice(currentIndex, 1);
      closedSet.add(`${current.x},${current.y}`);

      // Check all neighbors (4 directions: up, down, left, right)
      const neighbors = [
        { x: current.x, y: current.y - 1 }, // up
        { x: current.x, y: current.y + 1 }, // down
        { x: current.x - 1, y: current.y }, // left
        { x: current.x + 1, y: current.y }, // right
      ];

      for (const neighbor of neighbors) {
        // Skip if out of bounds or not walkable
        if (!this.isWalkable(grid, neighbor.x, neighbor.y)) {
          continue;
        }

        const neighborKey = `${neighbor.x},${neighbor.y}`;
        if (closedSet.has(neighborKey)) {
          continue;
        }

        const g = current.g + 1; // Cost from start to neighbor
        const h = this.heuristic(neighbor.x, neighbor.y, goal.x, goal.y);
        const f = g + h;

        // Check if neighbor is in open list
        const existingNode = openList.find((n) => n.x === neighbor.x && n.y === neighbor.y);

        if (existingNode) {
          // Update if this path is better
          if (g < existingNode.g) {
            existingNode.g = g;
            existingNode.f = f;
            existingNode.parent = current;
          }
        } else {
          // Add new node to open list
          openList.push({
            x: neighbor.x,
            y: neighbor.y,
            g,
            h,
            f,
            parent: current,
          });
        }
      }
    }

    // No path found
    return [];
  }

  /**
   * Check if a tile is walkable (not a wall or obstacle)
   */
  private static isWalkable(grid: number[][], x: number, y: number): boolean {
    if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) {
      return false;
    }

    const tile = grid[y][x];
    return tile !== TileType.WALL && tile !== TileType.OBSTACLE;
  }

  /**
   * Manhattan distance heuristic
   */
  private static heuristic(x1: number, y1: number, x2: number, y2: number): number {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  /**
   * Reconstruct path from goal node back to start
   */
  private static reconstructPath(node: Node): Point[] {
    const path: Point[] = [];
    let current: Node | null = node;

    while (current !== null) {
      path.unshift({ x: current.x, y: current.y });
      current = current.parent;
    }

    return path;
  }

  /**
   * Check if there's a clear line of sight between two points
   * Uses Bresenham's line algorithm
   */
  static hasLineOfSight(grid: number[][], from: Point, to: Point): boolean {
    if (!grid || grid.length === 0) return false;

    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    const sx = from.x < to.x ? 1 : -1;
    const sy = from.y < to.y ? 1 : -1;
    let err = dx - dy;

    let x = from.x;
    let y = from.y;

    while (true) {
      // Check if current tile is walkable (except start and end)
      if ((x !== from.x || y !== from.y) && (x !== to.x || y !== to.y)) {
        if (!this.isWalkable(grid, x, y)) {
          return false;
        }
      }

      if (x === to.x && y === to.y) {
        return true;
      }

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /**
   * Calculate Euclidean distance between two points
   */
  static distance(from: Point, to: Point): number {
    return Math.sqrt(Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2));
  }
}

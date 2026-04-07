package com.tutien.pixel.utils.maps;

import org.springframework.stereotype.Component;

import java.util.Random;
@Component
public class MapUtils {
    public static final int GRASS = 0;
    public static final int WATER = 1;
    public static final int MTN = 2;
    public static final int TREE = 3;
    public static final int WALL = 4;
    public static final int STONE = 5;
    public static final int FLOOR = 6;

    private int w;
    private int h;
    private Random rand = new Random();


    public int[][] build(int w, int h) {
        // Khởi tạo mảng 2 chiều và lấp đầy bằng GRASS
        int[][] tiles = new int[h][w];
        for (int i = 0; i < h; i++) {
            for (int j = 0; j < w; j++) {
                tiles[i][j] = GRASS;
            }
        }

        // Tạo tường bao
        borderWall(tiles, WALL);

        // Tạo Lakes (Ao hồ) - 3 lần
        for (int i = 0; i < 3; i++) {
            fillRect(tiles, randInt(5, 75), randInt(5, 50),
                    Math.round(rand.nextFloat() * 10) / 2,
                    Math.round(rand.nextFloat() * 10) / 3, WATER);
        }

        // Tạo Mountains (Núi) - 2 lần
        for (int i = 0; i < 2; i++) {
            fillRect(tiles, Math.round(rand.nextFloat() * 75), Math.round(rand.nextFloat() * 50),
                    Math.round(rand.nextFloat() * 10) / 2,
                    Math.round(rand.nextFloat() * 10) / 3, MTN);
        }

        // Tạo Tree clusters (Cụm cây) - 3 lần
        for (int i = 0; i < 3; i++) {
            fillRect(tiles, Math.round(rand.nextFloat() * 75), Math.round(rand.nextFloat() * 50),
                    Math.round(rand.nextFloat() * 10) / 2,
                    Math.round(rand.nextFloat() * 10) / 3, TREE);
        }

        // Phân tán đá
        scatter(tiles, STONE, 25, GRASS);

        // Tạo đường đi (Road)
        for (int y = 2; y < h - 2; y++) {
            if (tiles[y][26] == GRASS) {
                tiles[y][26] = FLOOR;
            }
        }

        // Phá tường phía Bắc để làm Portal
        if (w > 26) {
            tiles[0][26] = FLOOR;
            tiles[1][26] = FLOOR;
        }

        return tiles;
    }

    // 1. Fill hình chữ nhật
    public void fillRect(int[][] tiles, int x, int y, int w, int h, int v) {
        for (int dy = 0; dy < h; dy++) {
            for (int dx = 0; dx < w; dx++) {
                int ty = y + dy, tx = x + dx;
                if (ty >= 0 && ty < tiles.length && tx >= 0 && tx < tiles[0].length) {
                    tiles[ty][tx] = v;
                }
            }
        }
    }

    // 2. Tạo tường bao
    public void borderWall(int[][] t, int wallValue) {
        int H = t.length, W = t[0].length;
        for (int x = 0; x < W; x++) {
            t[0][x] = wallValue;
            t[H - 1][x] = wallValue;
        }
        for (int y = 0; y < H; y++) {
            t[y][0] = wallValue;
            t[y][W - 1] = wallValue;
        }
    }

    // 3. Phân tán ngẫu nhiên
    public void scatter(int[][] t, int v, int n, int grassValue) {
        int H = t.length, W = t[0].length;
        java.util.Random rand = new java.util.Random();
        for (int i = 0; i < n; i++) {
            int x = rand.nextInt(W - 4) + 2; // Random từ 2 đến W-3
            int y = rand.nextInt(H - 4) + 2; // Random từ 2 đến H-3
            if (t[y][x] == grassValue) t[y][x] = v;
        }
    }

    public int randInt(int min, int max) {
        return rand.nextInt((max - min) + 1) + min;
    }
}

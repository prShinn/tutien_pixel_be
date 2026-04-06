package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name="spawn_monster")
public class spawnMonsterEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private int mapCode;
    private int monsterCode;
    private int x;
    private int y;
    private int w;
    private int h;
    private int count;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public int getMapCode() {
        return mapCode;
    }

    public void setMapCode(int mapCode) {
        this.mapCode = mapCode;
    }

    public int getMonsterCode() {
        return monsterCode;
    }

    public void setMonsterCode(int monsterCode) {
        this.monsterCode = monsterCode;
    }

    public int getX() {
        return x;
    }

    public void setX(int x) {
        this.x = x;
    }

    public int getY() {
        return y;
    }

    public void setY(int y) {
        this.y = y;
    }

    public int getW() {
        return w;
    }

    public void setW(int w) {
        this.w = w;
    }

    public int getH() {
        return h;
    }

    public void setH(int h) {
        this.h = h;
    }

    public int getCount() {
        return count;
    }

    public void setCount(int count) {
        this.count = count;
    }
}

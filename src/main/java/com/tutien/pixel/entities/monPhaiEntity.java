package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name="monPhai")
public class monPhaiEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String name;
    private int soLuong;
    private int maxSoLuong;
    private int level;
    private int maxLevel;
    private String danhHieu;
    private String icon;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public int getSoLuong() {
        return soLuong;
    }

    public void setSoLuong(int soLuong) {
        this.soLuong = soLuong;
    }

    public int getMaxSoLuong() {
        return maxSoLuong;
    }

    public void setMaxSoLuong(int maxSoLuong) {
        this.maxSoLuong = maxSoLuong;
    }

    public int getLevel() {
        return level;
    }

    public void setLevel(int level) {
        this.level = level;
    }

    public int getMaxLevel() {
        return maxLevel;
    }

    public void setMaxLevel(int maxLevel) {
        this.maxLevel = maxLevel;
    }

    public String getDanhHieu() {
        return danhHieu;
    }

    public void setDanhHieu(String danhHieu) {
        this.danhHieu = danhHieu;
    }

    public String getIcon() {
        return icon;
    }

    public void setIcon(String icon) {
        this.icon = icon;
    }
}

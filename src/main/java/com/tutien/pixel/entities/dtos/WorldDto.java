package com.tutien.pixel.entities.dtos;

import jakarta.persistence.Column;

public class WorldDto {
    private int id;
    private String tenMap;
    private String code;
    private int[][] jsonMap;
    private int w;
    private int h;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getTenMap() {
        return tenMap;
    }

    public void setTenMap(String tenMap) {
        this.tenMap = tenMap;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public int[][] getJsonMap() {
        return jsonMap;
    }

    public void setJsonMap(int[][] jsonMap) {
        this.jsonMap = jsonMap;
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
}

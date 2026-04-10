package com.tutien.pixel.entities.dtos;

import com.tutien.pixel.entities.canhGioiEntity;
import com.tutien.pixel.entities.enums.linhCanEnum;
import com.tutien.pixel.entities.skillEntity;
import com.tutien.pixel.entities.statsEmbed;
import com.tutien.pixel.entities.trangBiEmbed;
import jakarta.persistence.Column;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;

import java.util.List;

public class PlayerDto {
    private int id;
    private int userId;
    private statsEmbed stats;

    private String name;
    @Enumerated(EnumType.STRING)
    private linhCanEnum linhCan;
    private String tenCanhGioi;
    private int tangTuVi;
    private String maCanhGioi;
    private int hp;
    private int maxHp;
    private int mp;
    private int maxMp;
    private int xu;
    private int tuViHienTai;
    private int tuViLenCap;
    private int x; //spawn tại x
    private int y; // spawn tai y
    private int px;
    private int py;
    private String mapCode;
    private trangBiEmbed trangBi;
    private int iventoryIndex;
    private int attackCD;
    private double heal_hp;
    private double heal_mp;
    private String jsonIventory;
    private String crit;
    private int speed;
    private List<skillEntity> skills;
    private canhGioiEntity canhGioi;
}
